// AI SDK React snapshots preserve nested values while shallow-cloning each
// message part. These helpers compare that snapshot boundary without falling
// back to serialization on every stream delta.
export function shallowEqualSnapshot(previous: object, next: object) {
  if (previous === next) return true;
  const previousRecord = previous as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;
  const keys = Object.keys(previousRecord);
  return (
    keys.length === Object.keys(nextRecord).length &&
    keys.every((key) => Object.is(previousRecord[key], nextRecord[key]))
  );
}

export function shallowEqualSnapshotList(previous: readonly object[], next: readonly object[]) {
  return (
    previous.length === next.length &&
    previous.every((item, index) => shallowEqualSnapshot(item, next[index] as object))
  );
}

// ReactChatState keeps the historical prefix by identity and replaces only the
// mutable message tail. Reuse the projection of that stable prefix so a token
// delta only evaluates the live message. Full history replacements fall back
// to an identity scan and rebuild the changed suffix; callers must preserve the
// SDK's suffix-only mutation contract when they retain historical identities.
export function createSnapshotTailProjection<Message extends object, Projection>(
  initial: Projection,
  extend: (previous: Projection, message: Message) => Projection,
  isEqual: (previous: Projection, next: Projection) => boolean = Object.is,
) {
  let previousMessages: readonly Message[] = [];
  const projections: Projection[] = [];

  return (messages: readonly Message[]) => {
    let start = 0;
    if (messages === previousMessages) return projections.at(-1) ?? initial;
    const previousProjection = projections.at(-1) ?? initial;

    if (
      messages.length === previousMessages.length &&
      messages.length > 1 &&
      messages.at(-2) === previousMessages.at(-2)
    ) {
      start = messages.at(-1) === previousMessages.at(-1) ? messages.length : messages.length - 1;
    } else if (
      messages.length > previousMessages.length &&
      (previousMessages.length === 0 || messages[previousMessages.length - 1] === previousMessages.at(-1))
    ) {
      start = previousMessages.length;
    } else if (
      messages.length < previousMessages.length &&
      (messages.length === 0 || messages.at(-1) === previousMessages[messages.length - 1])
    ) {
      start = messages.length;
    } else {
      const limit = Math.min(messages.length, previousMessages.length);
      while (start < limit && messages[start] === previousMessages[start]) start += 1;
    }

    projections.length = start;
    let projection = projections.at(-1) ?? initial;
    for (let index = start; index < messages.length; index++) {
      projection = extend(projection, messages[index]);
      projections.push(projection);
    }
    if (isEqual(previousProjection, projection)) {
      projection = previousProjection;
      if (projections.length > 0) projections[projections.length - 1] = projection;
    }
    previousMessages = messages;
    return projection;
  };
}

export function createSnapshotItemIndex<Message, Key>(keyOf: (message: Message) => Key) {
  let previousKey: Key | null = null;
  let previousIndex = -1;
  return (messages: readonly Message[], key: Key | null) => {
    if (key === null) return -1;
    if (
      Object.is(key, previousKey) &&
      previousIndex >= 0 &&
      previousIndex < messages.length &&
      Object.is(keyOf(messages[previousIndex]), key)
    ) {
      return previousIndex;
    }
    previousKey = key;
    previousIndex = messages.findIndex((message) => Object.is(keyOf(message), key));
    return previousIndex;
  };
}
