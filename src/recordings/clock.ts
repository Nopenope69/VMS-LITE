export interface IClock {
  now(): Date;
  setTimeout(callback: () => void, ms: number): NodeJS.Timeout;
  setInterval(callback: () => void, ms: number): NodeJS.Timeout;
  clearTimeout(timeoutId: NodeJS.Timeout): void;
  clearInterval(intervalId: NodeJS.Timeout): void;
}

export class SystemClock implements IClock {
  now(): Date {
    return new Date();
  }

  setTimeout(callback: () => void, ms: number): NodeJS.Timeout {
    return setTimeout(callback, ms);
  }

  setInterval(callback: () => void, ms: number): NodeJS.Timeout {
    return setInterval(callback, ms);
  }

  clearTimeout(timeoutId: NodeJS.Timeout): void {
    clearTimeout(timeoutId);
  }

  clearInterval(intervalId: NodeJS.Timeout): void {
    clearInterval(intervalId);
  }
}

export class TestClock implements IClock {
  private currentTime: Date;
  private timerIdCounter = 1;
  private readonly intervals: Map<number, { callback: () => void; ms: number }> = new Map();
  private readonly timeouts: Map<number, { callback: () => void; ms: number }> = new Map();

  constructor(initialTime: Date = new Date('2026-09-24T12:00:00.000Z')) {
    this.currentTime = new Date(initialTime);
  }

  now(): Date {
    return new Date(this.currentTime);
  }

  setTime(time: Date): void {
    this.currentTime = new Date(time);
  }

  advance(ms: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }

  setTimeout(callback: () => void, ms: number): NodeJS.Timeout {
    const id = this.timerIdCounter++;
    this.timeouts.set(id, { callback, ms });
    return id as unknown as NodeJS.Timeout;
  }

  setInterval(callback: () => void, ms: number): NodeJS.Timeout {
    const id = this.timerIdCounter++;
    this.intervals.set(id, { callback, ms });
    return id as unknown as NodeJS.Timeout;
  }

  clearTimeout(timeoutId: NodeJS.Timeout): void {
    this.timeouts.delete(Number(timeoutId));
  }

  clearInterval(intervalId: NodeJS.Timeout): void {
    this.intervals.delete(Number(intervalId));
  }

  tickIntervals(): void {
    for (const item of this.intervals.values()) {
      item.callback();
    }
  }

  hasActiveIntervals(): boolean {
    return this.intervals.size > 0;
  }
}

export const systemClock = new SystemClock();
