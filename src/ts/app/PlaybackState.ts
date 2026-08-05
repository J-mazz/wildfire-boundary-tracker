export class PlaybackState {
  private live = true;
  private playing = false;

  get isLive(): boolean {
    return this.live;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  selectHistorical(): void {
    this.live = false;
  }

  start(snapshotCount: number): boolean {
    if (snapshotCount < 2) return false;
    this.live = false;
    this.playing = true;
    return true;
  }

  stop(): void {
    this.playing = false;
  }

  goLive(): void {
    this.live = true;
    this.playing = false;
  }
}
