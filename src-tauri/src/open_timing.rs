//! Opt-in diagnostics; no document data or filesystem paths are logged.
use std::{io::Write, sync::OnceLock, time::Instant};
pub(crate) struct OpenTiming(Option<Instant>);
impl OpenTiming {
    pub(crate) fn new() -> Self {
        static ENABLED: OnceLock<bool> = OnceLock::new();
        Self(
            ENABLED
                .get_or_init(|| std::env::var_os("READER_OPEN_TIMING").is_some())
                .then(Instant::now),
        )
    }
    pub(crate) fn mark(&mut self, stage: &str) {
        if let Some(start) = &mut self.0 {
            let elapsed = start.elapsed().as_secs_f64() * 1000.0;
            let _ = writeln!(
                std::io::stderr(),
                "open_timing stage={stage} elapsed_ms={elapsed:.3}"
            );
            *start = Instant::now();
        }
    }
}
