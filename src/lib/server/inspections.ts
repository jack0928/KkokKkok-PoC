import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MAX_IMAGE_BYTES } from "../discovery";
import { inspectionFactors } from "../inspection-result";
import { InputError,readLimitedBody,sha256 } from "./image";
import { enqueueImage } from "./jobs";
import { extractImageGps } from "./image-gps";
import { withDatabase,transaction,RecordConflict,recordDetail,findRecord } from "./records";
import { inspectionImageUrl } from "./inspection-access";

const contextSchema=z.object({address:z.string().trim().max(500).nullable(),placeId:z.string().uuid().nullable(),locationRole:z.enum(["capture","sensitive"]),compareHistory:z.boolean()}).refine(v=>!v.address||!v.placeId,"주소와 장소 ID 중 하나만 입력해 주세요.");
type Context=z.infer<typeof contextSchema>;
function database<T>(fn:Parameters<typeof withDatabase<T>>[0]):T {return withDatabase(db=>{
  db.exec(`CREATE TABLE IF NOT EXISTS inspection_requests (
    request_key TEXT PRIMARY KEY, record_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
    context_json TEXT NOT NULL, gps_status TEXT NOT NULL, lease_until INTEGER NOT NULL
  ) STRICT`);return fn(db);
});}
export function inspectionId(value:string) {if(!z.string().uuid().safeParse(value).success)throw new InputError("검사 ID가 올바르지 않습니다.");return value;}
export async function parseInspection(request:Request) {
  const key=inspectionId(request.headers.get("idempotency-key")??"");
  const contentType=request.headers.get("content-type")??"";
  if(!contentType.toLowerCase().startsWith("multipart/form-data"))throw new InputError("multipart/form-data 요청이 필요합니다.",415);
  const bytes=await readLimitedBody(request,11*1024*1024);
  let form:FormData;
  try{form=await new Request("http://localhost",{method:"POST",headers:{"Content-Type":contentType},body:new Uint8Array(bytes)}).formData();}
  catch{throw new InputError("multipart 요청을 읽을 수 없습니다.");}
  const allowed=new Set(["photo","address","placeId","locationRole","compareHistory"]);
  for(const name of form.keys())if(!allowed.has(name)||form.getAll(name).length!==1)throw new InputError("중복되거나 지원하지 않는 입력 필드입니다.");
  const photo=form.get("photo");if(!photo||typeof photo==="string"||photo.size===0)throw new InputError("사진이 필요합니다.");
  if(photo.size>MAX_IMAGE_BYTES)throw new InputError("사진은 10MB 이하여야 합니다.",413);
  const field=(name:string,fallback:string)=>{const v=form.get(name);if(v!==null&&typeof v!=="string")throw new InputError("문자열 입력이 필요합니다.");return v??fallback;};
  const history=field("compareHistory","false");if(!["true","false"].includes(history))throw new InputError("compareHistory는 true 또는 false여야 합니다.");
  const parsed=contextSchema.safeParse({address:field("address","").trim()||null,placeId:field("placeId","").trim()||null,locationRole:field("locationRole","capture"),compareHistory:history==="true"});
  if(!parsed.success)throw new InputError("주소·장소 ID·locationRole 입력을 확인해 주세요.");
  return {key,photo:Buffer.from(await photo.arrayBuffer()),context:parsed.data};
}
export async function createInspection(input:Awaited<ReturnType<typeof parseInspection>>) {
  const fingerprint=sha256(Buffer.from(JSON.stringify({photo:sha256(input.photo),...input.context})));
  const claim=database(db=>transaction(db,()=>{
    const row=db.prepare("SELECT * FROM inspection_requests WHERE request_key=?").get(input.key);
    if(row) {
      if(row.fingerprint!==fingerprint)throw new RecordConflict("같은 요청 키로 다른 사진 또는 장소 정보를 보낼 수 없습니다.");
      const id=String(row.record_id);
      if(row.gps_status!=="pending"&&!findRecord(db,id))throw new InputError("삭제된 검사 요청입니다. 새 요청 키를 사용해 주세요.",404);
      if(findRecord(db,id)||Number(row.lease_until)>Date.now())return {id,execute:false};
      db.prepare("UPDATE inspection_requests SET lease_until=? WHERE request_key=?").run(Date.now()+300000,input.key);
      return {id,execute:true};
    }
    const id=randomUUID();db.prepare("INSERT INTO inspection_requests VALUES (?,?,?,?,?,?)").run(input.key,id,fingerprint,JSON.stringify(input.context),"pending",Date.now()+300000);
    return {id,execute:true};
  }));
  if(claim.execute)try {
    const gps=await extractImageGps(input.photo);
    await enqueueImage(input.photo,claim.id,true);
    database(db=>db.prepare("UPDATE inspection_requests SET gps_status=?,lease_until=0 WHERE record_id=?").run(gps.status,claim.id));
  }catch(error){database(db=>db.prepare("UPDATE inspection_requests SET lease_until=0 WHERE record_id=?").run(claim.id));throw error;}
  return readInspection(claim.id);
}
export function readInspection(id:string) {
  inspectionId(id);
  const row=database(db=>db.prepare("SELECT * FROM inspection_requests WHERE record_id=?").get(id));
  if(!row)throw new InputError("검사를 찾을 수 없습니다.",404);
  const detail=recordDetail(id),context=JSON.parse(String(row.context_json)) as Context;
  const status=detail?(detail.job.status==="analyzing"?"processing":detail.job.status==="completed"?"completed":detail.job.status==="failed"?"failed":"queued"):(Number(row.lease_until)>Date.now()?"queued":"failed");
  return {schemaVersion:1,inspectionId:id,status,
    image:detail?{url:inspectionImageUrl(id),width:detail.record.image.width,height:detail.record.image.height,coordinateSpace:"analysis-normalized"}:null,
    progress:detail?.record.pipeline??null,
    riskSummary:{score:null,level:"pending",reason:"검증된 누적 위험 점수 산정은 아직 지원하지 않습니다."},
    riskFactors:detail?inspectionFactors(detail.record,String(row.gps_status)):[],
    repeatedExposure:{status:context.compareHistory?"unavailable":"not_requested",message:context.compareHistory?"게시 이력 비교는 아직 지원하지 않습니다.":"게시 이력 비교를 요청하지 않았습니다.",matchedImageIds:[],samePlaceConfirmed:false},
    locationContext:{provided:!!(context.address||context.placeId),role:context.locationRole,status:"not_evaluated"},
    metadata:{gpsStatus:row.gps_status},
    error:status==="failed"?{code:"ANALYSIS_FAILED",message:"검사가 완료되지 않았습니다. 완료된 부분 결과는 보존됩니다. 관리 화면에서 확인해 주세요."}:null};
}
