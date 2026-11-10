import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { asyncHandler, errorHandler, HttpError, notFound } from '../src/http.js';

test('HttpError stores status and message', () => {
  const error = new HttpError(418, 'Teapot');

  assert.equal(error.status, 418);
  assert.equal(error.message, 'Teapot');
});

test('asyncHandler forwards rejected errors', async () => {
  const expected = new Error('boom');
  let forwarded: unknown;

  const handler = asyncHandler(async () => {
    throw expected;
  });

  handler({} as never, {} as never, (error) => {
    forwarded = error;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(forwarded, expected);
});

test('notFound forwards a 404 HttpError', () => {
  let forwarded: unknown;

  notFound({ method: 'GET', originalUrl: '/missing' } as never, {} as never, (error) => {
    forwarded = error;
  });

  assert.ok(forwarded instanceof HttpError);
  assert.equal((forwarded as HttpError).status, 404);
  assert.match((forwarded as HttpError).message, /GET \/missing/);
});

test('errorHandler formats Zod errors as bad requests', () => {
  let statusCode = 0;
  let payload: unknown;
  const schema = z.object({ email: z.string().email() });

  errorHandler(schema.safeParse({ email: 'bad' }).error, {} as never, {
    status(status: number) {
      statusCode = status;
      return this;
    },
    json(body: unknown) {
      payload = body;
      return this;
    }
  } as never, (() => undefined) as never);

  assert.equal(statusCode, 400);
  assert.deepEqual((payload as { error: string }).error, 'Datos inválidos.');
});

test('errorHandler formats HttpError and unknown errors', () => {
  const statuses: number[] = [];
  const payloads: unknown[] = [];
  const response = {
    status(status: number) {
      statuses.push(status);
      return this;
    },
    json(body: unknown) {
      payloads.push(body);
      return this;
    }
  } as never;

  errorHandler(new HttpError(401, 'Nope'), {} as never, response, (() => undefined) as never);
  errorHandler('weird', {} as never, response, (() => undefined) as never);

  assert.deepEqual(statuses, [401, 500]);
  assert.deepEqual(payloads, [{ error: 'Nope' }, { error: 'Unexpected server error' }]);
});
