export function splitScriptInstruction(copy: string) {
  const sentenceEnd = copy.search(/[。．.]/);
  if (sentenceEnd < 0) {
    return { formatReference: "", instruction: copy };
  }

  return {
    instruction: copy.slice(0, sentenceEnd + 1).trim(),
    formatReference: copy.slice(sentenceEnd + 1).trim(),
  };
}
