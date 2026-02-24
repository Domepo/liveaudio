export class HttpError extends Error {
  status: number;
  url: string;
  body: unknown;

  constructor(message: string, status: number, url: string, body: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

