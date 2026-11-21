export type FetchResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
};

export type FetchLike = (path: string, init?: RequestInit) => Promise<FetchResponse>;
