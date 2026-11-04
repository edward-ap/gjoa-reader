//! Cooperative import cancellation, independent of the Library/render locks.
use std::{
    cell::RefCell,
    collections::HashMap,
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
};
type Token = Arc<AtomicBool>;
static TOKENS: OnceLock<Mutex<HashMap<u64, Token>>> = OnceLock::new();
thread_local! { static CURRENT: RefCell<Option<Token>> = const { RefCell::new(None) }; }
fn tokens() -> &'static Mutex<HashMap<u64, Token>> {
    TOKENS.get_or_init(Mutex::default)
}
pub fn register(id: u64) {
    tokens()
        .lock()
        .unwrap()
        .insert(id, Arc::new(AtomicBool::new(false)));
}
pub fn token(id: u64) -> Option<Token> {
    tokens().lock().unwrap().get(&id).cloned()
}
pub fn cancel(id: u64) {
    if let Some(token) = token(id) {
        token.store(true, Ordering::Relaxed);
    }
}
pub fn remove(id: u64) {
    tokens().lock().unwrap().remove(&id);
}
pub struct Scope(Option<Token>);
impl Scope {
    pub fn enter(token: Option<Token>) -> Self {
        Self(CURRENT.with(|current| current.replace(token)))
    }
}
impl Drop for Scope {
    fn drop(&mut self) {
        CURRENT.with(|current| current.replace(self.0.take()));
    }
}
pub fn check() -> Result<(), String> {
    if CURRENT.with(|current| {
        current
            .borrow()
            .as_ref()
            .is_some_and(|t| t.load(Ordering::Relaxed))
    }) {
        Err("Import canceled".into())
    } else {
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_reaches_worker_without_library_lock_and_scope_is_cleared() {
        let id = u64::MAX;
        register(id);
        let token = token(id);
        let worker = std::thread::spawn(move || {
            let _scope = Scope::enter(token);
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while check().is_ok() {
                assert!(std::time::Instant::now() < deadline);
                std::thread::yield_now();
            }
            assert!(check().is_err());
            // Shared in-memory hashes are infallible at some call sites (font profile).
            assert!(crate::library::store::hash_reader(&b"font"[..]).is_ok());
            assert!(crate::library::store::hash_import_reader(&b"source"[..]).is_err());
            drop(_scope);
            assert!(check().is_ok());
        });
        cancel(id);
        worker.join().unwrap();
        remove(id);
        assert!(check().is_ok());
    }
}
