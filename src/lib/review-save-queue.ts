import type { DiscoveryRecord } from "./discovery";

// Serialize writes while allowing input to continue. The server version belongs
// to the last acknowledged snapshot, not to the latest local edit.
export class ReviewSaveQueue {
  current: DiscoveryRecord;
  version: string;
  error: string | null = null;
  private revision = 0;
  private acknowledged = 0;
  private active: Promise<boolean> | null = null;

  constructor(record: DiscoveryRecord, private transport: (record: DiscoveryRecord, version: string) => Promise<DiscoveryRecord>, private notify: () => void) {
    this.current = record; this.version = record.updatedAt;
  }
  get dirty() { return this.revision !== this.acknowledged; }
  get saving() { return this.active !== null; }
  update(record: DiscoveryRecord) { this.current = record; this.revision++; this.error = null; this.notify(); }

  async save(complete = false): Promise<boolean> {
    if (this.active) {
      const success = await this.active;
      if (!success) return false;
      return complete || this.dirty ? this.save(complete) : true;
    }
    const revision = this.revision;
    const snapshot = { ...this.current, reviewCompletedAt: complete ? new Date().toISOString() : this.current.reviewCompletedAt };
    this.error = null;
    // Start on the next microtask, after active is assigned.
    const work = Promise.resolve().then(() => this.transport(snapshot, this.version)).then((saved) => {
      this.version = saved.updatedAt; this.acknowledged = revision;
      if (this.revision === revision) this.current = saved;
      return true;
    }).catch((error) => { this.error = error instanceof Error ? error.message : "저장 실패"; return false; })
      .finally(() => { this.active = null; this.notify(); });
    this.active = work; this.notify();
    return work;
  }
}
