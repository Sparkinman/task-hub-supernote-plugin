import {PluginCommAPI, PluginNoteAPI} from 'sn-plugin-lib';

/**
 * Turns the current lasso selection into a single task title.
 *
 * A selection can hold typed text boxes, titles and raw handwriting at the same
 * time. Text boxes already carry a string; handwriting has to go through the
 * on-device recognizer.
 */

/**
 * Most PluginCommAPI methods are declared `Promise<Object | null | undefined>`
 * rather than APIResponse<T>, so the response shape has to be narrowed by hand.
 * APIResponse itself uses `result: T | null` and `error: APIResponseError | null`
 * — both nullable, neither optional.
 */
interface LooseResponse<T> {
  success?: boolean;
  result?: T | null;
  error?: {message?: string} | null;
}

function unwrap<T>(res: unknown, what: string): T {
  const parsed = res as LooseResponse<T> | null | undefined;
  if (!parsed?.success || parsed.result === null || parsed.result === undefined) {
    throw new Error(`${what} failed: ${parsed?.error?.message ?? 'unknown error'}`);
  }
  return parsed.result;
}

/** Collapse handwriting-recognition output into one line. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export async function readLassoAsText(): Promise<string> {
  // Prefer any typed text already in the selection — it needs no recognition
  // and is exact.
  const typed: string[] = [];

  try {
    const textBoxes = unwrap<{textContentFull?: string | null}[]>(
      await PluginNoteAPI.getLassoText(),
      'getLassoText',
    );
    for (const box of textBoxes) {
      // The field is textContentFull, not `text`.
      const value = box?.textContentFull;
      if (value) {
        typed.push(value);
      }
    }
  } catch {
    // DOC has no note text boxes; fall through to recognition.
  }

  if (typed.length > 0) {
    return normalize(typed.join(' '));
  }

  const elements = unwrap<object[]>(await PluginCommAPI.getLassoElements(), 'getLassoElements');
  if (elements.length === 0) {
    throw new Error('Nothing selected.');
  }

  // getPageDisplaySize is the current-page equivalent of PluginFileAPI.getPageSize
  // and — unlike getPageSize — is not FILE:READ-gated, so it keeps this path
  // working without declaring a file permission we do not otherwise need.
  const size = unwrap<{width: number; height: number}>(
    await PluginCommAPI.getPageDisplaySize(),
    'getPageDisplaySize',
  );

  const recognized = unwrap<string>(
    await PluginCommAPI.recognizeElements(elements, size),
    'recognizeElements',
  );

  const title = normalize(recognized);
  if (!title) {
    throw new Error('Could not read any text from that selection.');
  }
  return title;
}

export interface SourceRef {
  /** Absolute path of the note the task was captured from. */
  path: string;
  /** Page index as the host reports it, stored unchanged so openFile round-trips. */
  page: number;
}

/**
 * Where the task was captured from, so it can be reopened later.
 *
 * Recorded as its own properties on the VTODO rather than pushed into
 * DESCRIPTION: the description is the user's space to write in, and a path
 * sitting there would have to be deleted every time.
 */
export async function readSourceRef(): Promise<SourceRef | undefined> {
  try {
    const path = unwrap<string>(await PluginCommAPI.getCurrentFilePath(), 'getCurrentFilePath');
    const page = unwrap<number>(await PluginCommAPI.getCurrentPageNum(), 'getCurrentPageNum');
    return {path, page};
  } catch {
    return undefined;
  }
}
