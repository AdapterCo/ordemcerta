import { applyDecorators, Body, PipeTransform, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery } from '@nestjs/swagger';
import type { ZodTypeAny, z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    // ZodError é convertido em 422 VALIDATION_ERROR pelo filtro global.
    return this.schema.parse(value ?? {});
  }
}

/** Corpo validado com o mesmo schema Zod usado no frontend (@ordemcerta/shared). */
export const ZBody = <T extends ZodTypeAny>(schema: T) => Body(new ZodPipe(schema));
export const ZQuery = <T extends ZodTypeAny>(schema: T) => Query(new ZodPipe(schema));

function jsonSchema(schema: ZodTypeAny) {
  return (zodToJsonSchema as (s: unknown, o: unknown) => unknown)(schema, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>;
}

/** Documentação OpenAPI derivada do schema Zod. */
export function Doc(summary: string, opts: { body?: ZodTypeAny; query?: ZodTypeAny; description?: string } = {}) {
  const decorators = [ApiOperation({ summary, description: opts.description })];
  if (opts.body) decorators.push(ApiBody({ schema: jsonSchema(opts.body) }));
  if (opts.query) {
    const props = (jsonSchema(opts.query).properties ?? {}) as Record<string, Record<string, unknown>>;
    for (const [name, schema] of Object.entries(props)) decorators.push(ApiQuery({ name, required: false, schema }));
  }
  return applyDecorators(...decorators);
}
