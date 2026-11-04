//! Development timing only; never part of edition identity or persisted pages.
#[derive(Default, Clone, serde::Serialize)]
pub struct Timings {
    pub parse_ms: f64,
    pub resolution_ms: f64,
    pub measurement_ms: f64,
}
thread_local! {static TIMINGS:std::cell::RefCell<Timings>=std::cell::RefCell::new(Timings::default());}
pub fn reset() {
    TIMINGS.with(|t| *t.borrow_mut() = Timings::default());
}
pub fn get() -> Timings {
    TIMINGS.with(|t| t.borrow().clone())
}
pub(crate) fn parsed(parse_ms: f64, resolution_ms: f64) {
    TIMINGS.with(|t| {
        t.borrow_mut().parse_ms = parse_ms;
        t.borrow_mut().resolution_ms = resolution_ms;
    });
}
pub(crate) fn measured(ms: f64) {
    TIMINGS.with(|t| t.borrow_mut().measurement_ms = ms);
}
