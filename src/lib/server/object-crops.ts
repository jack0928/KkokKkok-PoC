import "server-only";
import sharp from "sharp";
import { createHash } from "node:crypto";
import type { DiscoveryRecord } from "../discovery";

export async function objectCrops(record: DiscoveryRecord, bytes: Buffer) {
  if (!record.grounding || createHash("sha256").update(bytes).digest("hex") !== record.image.analysisSha256) throw new Error("Image mismatch");
  const meta = await sharp(bytes).metadata();
  if (meta.width !== record.image.width || meta.height !== record.image.height) throw new Error("Image dimensions mismatch");
  const crops = [];
  for (const detection of record.grounding.detections) {
    const [x1,y1,x2,y2] = detection.bbox;
    const left = Math.floor(x1*meta.width), top = Math.floor(y1*meta.height);
    const width = Math.max(1,Math.ceil(x2*meta.width)-left), height = Math.max(1,Math.ceil(y2*meta.height)-top);
    const cropped = await sharp(bytes).extract({left,top,width,height}).resize({width:512,height:512,fit:"inside",withoutEnlargement:true}).png().toBuffer();
    const header = Buffer.from(`<svg width="512" height="32"><rect width="512" height="32" fill="white"/><text x="8" y="23" font-size="20" fill="black">${detection.id}</text></svg>`);
    const size = await sharp(cropped).metadata();
    const labelled = await sharp({create:{width:512,height:size.height!+32,channels:3,background:"white"}}).composite([{input:header,left:0,top:0},{input:cropped,left:0,top:32}]).jpeg({quality:85}).toBuffer();
    crops.push({id:detection.id,label:detection.label,bbox:detection.bbox,pixelBounds:{left,top,width,height},imageUrl:`data:image/jpeg;base64,${labelled.toString("base64")}`});
  }
  return crops;
}
