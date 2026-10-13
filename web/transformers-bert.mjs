// Fixed-model adapter for the exact Transformers.js 4.3.1 source distribution.
// Importing only BERT avoids retaining the SDK's unrelated model registry.
import { BertModel } from '@release-sieve/transformers/models/bert/modeling_bert.js';
import { BertTokenizer } from '@release-sieve/transformers/models/bert/tokenization_bert.js';
import {
  MODEL_CLASS_TO_NAME_MAPPING, MODEL_NAME_TO_CLASS_MAPPING, MODEL_TYPE_MAPPING,
  registerTaskMappings,
} from '@release-sieve/transformers/models/modeling_utils.js';
import { MODEL_TYPES } from '@release-sieve/transformers/models/session_config.js';

MODEL_CLASS_TO_NAME_MAPPING.set(BertModel, 'BertModel');
MODEL_NAME_TO_CLASS_MAPPING.set('BertModel', BertModel);
MODEL_TYPE_MAPPING.set('BertModel', MODEL_TYPES.EncoderOnly);
MODEL_TYPE_MAPPING.set('bert', MODEL_TYPES.EncoderOnly);
registerTaskMappings({ encoder: new Map([['bert', 'BertModel']]) });

export { BertModel, BertTokenizer };
export { env } from '@release-sieve/transformers/env.js';
export { mean_pooling } from '@release-sieve/transformers/utils/tensor.js';
