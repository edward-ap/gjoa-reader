// Preserve page-save order and finish pending saves before replacing a document.
export function createProgressWriter(invoke, onError) {
  let tail = Promise.resolve();
  return {
    save(documentId, pageIndex) {
      tail = tail.then(() => invoke('save_book_progress', { documentId, pageIndex }))
        .catch(error => onError(error, documentId));
      return tail;
    },
    flush() { return tail; },
  };
}
