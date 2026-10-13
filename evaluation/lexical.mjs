/** Transparent lexical comparator: lowercase Unicode alphanumeric term counts. */
export function lexicalVectors(texts) {
  const tokenized = texts.map(text => {
    if (typeof text !== 'string') throw new TypeError('Lexical inputs must be strings.');
    const tokens = text.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu) ?? [];
    if (!tokens.length) throw new TypeError('Lexical inputs must contain an alphanumeric token.');
    return tokens;
  });
  const vocabulary = new Map();
  for (const tokens of tokenized) for (const token of tokens) if (!vocabulary.has(token)) vocabulary.set(token,vocabulary.size);
  return tokenized.map(tokens => {
    const vector = Array(vocabulary.size).fill(0);
    for (const token of tokens) vector[vocabulary.get(token)]++;
    return vector;
  });
}

export const lexicalEmbed = async texts => lexicalVectors(texts);
