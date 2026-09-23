'use client';
import type { ComponentProps } from 'react';
import { type OpenAPIComponents, useComponents } from 'fumadocs-openapi';

export function ClientCodeBlock(props: ComponentProps<OpenAPIComponents['CodeBlock']>) {
  const { CodeBlock } = useComponents();

  return <CodeBlock {...props} />;
}
