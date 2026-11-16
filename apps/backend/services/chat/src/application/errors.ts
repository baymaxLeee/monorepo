export class RequestError extends Error {
  readonly status = 400;
  readonly code = "bad_request";
}

export class NotFoundError extends Error {
  readonly status = 404;
  readonly code = "not_found";
}

export class RuntimeResponseError extends Error {
  constructor(readonly response: Response) {
    super(`Runtime request failed with status ${response.status}`);
  }
}
