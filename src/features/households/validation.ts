import { z } from 'zod';

/** Mesmas regras das constraints do banco; o banco continua sendo a autoridade. */
export const createHouseholdSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'Informe um nome.' })
    .max(80, { error: 'Use no máximo 80 caracteres.' }),
  kind: z.enum(['personal', 'family'], { error: 'Escolha o tipo de espaço.' }),
});

export type CreateHouseholdForm = z.infer<typeof createHouseholdSchema>;
