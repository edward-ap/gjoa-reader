//! Opt-in, process-local development measurements. Never persisted in editions.
use std::{
    collections::BTreeMap,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};
static ENABLED: AtomicBool = AtomicBool::new(false);
static VALUES: Mutex<BTreeMap<&'static str, f64>> = Mutex::new(BTreeMap::new());
pub fn start() {
    VALUES.lock().unwrap().clear();
    ENABLED.store(true, Ordering::Relaxed);
}
pub fn finish() -> BTreeMap<String, f64> {
    ENABLED.store(false, Ordering::Relaxed);
    VALUES
        .lock()
        .unwrap()
        .iter()
        .map(|(k, v)| (k.to_string(), *v))
        .collect()
}
pub fn count(name: &'static str, n: usize) {
    if ENABLED.load(Ordering::Relaxed) {
        *VALUES.lock().unwrap().entry(name).or_default() += n as f64;
    }
}
pub struct Timer(Option<(&'static str, Instant)>);
pub fn stage(name: &'static str) -> Timer {
    Timer(
        ENABLED
            .load(Ordering::Relaxed)
            .then(|| (name, Instant::now())),
    )
}
impl Drop for Timer {
    fn drop(&mut self) {
        if let Some((name, started)) = self.0 {
            *VALUES.lock().unwrap().entry(name).or_default() +=
                started.elapsed().as_secs_f64() * 1000.;
        }
    }
}
