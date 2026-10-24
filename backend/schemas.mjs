import { z } from 'zod';

const parameters = {
  cpu: z.strictObject({ limit: z.number().int().min(100).max(20000000).default(100000) }),
  csv: z.strictObject({ group_by: z.string().max(80).default(''), value_column: z.string().max(80).default(''),
    trim_whitespace:z.boolean().default(true),deduplicate:z.boolean().default(false),drop_missing:z.boolean().default(false),
    invalid_numeric:z.enum(['fail','skip']).default('fail'),detect_outliers:z.boolean().default(true) }),
  images: z.strictObject({ width: z.number().int().min(16).max(2048).default(256) }),
};
export const taskSchema = z.strictObject({
  name: z.string().trim().min(1).max(120), kind: z.enum(['cpu','csv','images']).default('cpu'),
  parameters: z.record(z.string(), z.unknown()).default({}), cpu: z.number().min(.25).max(64).default(1),
  memory_mb: z.number().int().min(64).max(65536).default(256), priority: z.number().int().min(0).max(2).default(1),
  timeout_seconds: z.number().int().min(1).max(3600).default(180), max_retries: z.number().int().min(0).max(5).default(2),
  input_id: z.string().uuid().nullable().default(null),
}).transform((task, ctx) => {
  const parsed = parameters[task.kind].safeParse(task.parameters);
  if (!parsed.success || (task.kind !== 'cpu' && !task.input_id) || (task.kind === 'cpu' && task.input_id)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid template parameters or missing/incompatible input' }); return z.NEVER;
  }
  return { ...task, parameters: parsed.data };
});
export const registerSchema = z.strictObject({ name: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/), cpu: z.number().min(.25).max(256),
  memory_mb: z.number().int().min(64).max(1048576), max_parallel: z.number().int().min(1).max(16).default(1),
  instance_id: z.string().max(80).nullable().default(null), instance_type: z.string().max(80).nullable().default(null), region: z.string().max(40).nullable().default(null) });
export const heartbeatSchema = z.strictObject({ cpu_percent: z.number().min(0).max(100), memory_percent: z.number().min(0).max(100), active_attempt_ids: z.array(z.string().uuid()).max(16).default([]) });
export const progressSchema = z.strictObject({ logs: z.string().max(16000).default('') });
export const completionSchema = progressSchema.extend({ result: z.record(z.string(), z.unknown()), output_id: z.string().uuid(), exit_code: z.literal(0).default(0) });
export const failureSchema = progressSchema.extend({ error: z.string().min(1).max(2000), exit_code: z.number().int().default(1) });
export const settingsSchema = z.strictObject({ algorithm: z.enum(['round_robin','least_loaded','resource_aware']) });
export const experimentSchema = z.strictObject({
  name:z.string().trim().min(1).max(100),algorithm:z.enum(['round_robin','least_loaded','resource_aware']),
  mix:z.enum(['quick','mixed','repeat_task']).default('quick'),job_count:z.number().int().min(2).max(12).default(6),
  source_task_id:z.string().uuid().optional(),
}).superRefine((v,ctx)=>{if(v.mix==='repeat_task'&&!v.source_task_id)ctx.addIssue({code:'custom',message:'Choose a source workload for a repeated-task experiment'});});
