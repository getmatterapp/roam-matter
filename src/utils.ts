export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function randomInt(range: number) {
  const sign = Math.round(Math.random()) * 2 - 1;
  const abs = Math.floor(Math.random() * range);
  return sign * abs;
}

export function diffInMinutes(a: Date, b: Date): number {
  const diffMs = (a as any) - (b as any)
  const diffS = diffMs / 1000;
  return diffS / 60;
}