export type Env = Cloudflare.Env & {
  SERVER_HOST: string;
};

export type Caches = {
  default: {
    put(request: Request | string, response: Response): Promise<undefined>;
    match(request: Request | string): Promise<Response | undefined>;
    delete(request: Request | string): Promise<boolean>;
  };
  open: (cacheName: string) => Promise<Cache>;
};

export type AssetConfig = {
  RESIZER_HOST: string;
  RESIZER_TOKEN?: string;
  CDN_HOST: string;
};

export type AssetRequest = {
  url: URL;
  mimeType?: string;
  headers: Headers;
  params: Record<string, string>;
};
