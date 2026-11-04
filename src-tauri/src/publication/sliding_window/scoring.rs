//! Normalized window costs: first page 1, second 0.75, third 0.5.
//! The future together outweighs one immediate page, protecting against greedy fill.
use super::*;
pub const WINDOW_WEIGHTS: [f64; 3] = [1., 0.75, 0.5];
#[derive(Clone, Default, Serialize)]
pub struct Cost {
    pub whitespace: f64,
    pub side_void: f64,
    pub narrow_wrap: f64,
    pub widow_orphan: f64,
    pub image_movement: f64,
    pub image_scale: f64,
    pub note_split: f64,
    pub isolated_image: f64,
    pub short_below_image: f64,
}
impl Cost {
    pub fn total(&self) -> f64 {
        self.whitespace
            + self.side_void
            + self.narrow_wrap
            + self.widow_orphan
            + self.image_movement
            + self.image_scale
            + self.note_split
            + self.isolated_image
            + self.short_below_image
    }
}
#[allow(clippy::too_many_arguments)]
pub(super) fn score(
    bottom: f32,
    intentional: bool,
    narrow: f64,
    orphan: f64,
    one_row: bool,
    lines: usize,
    images: &[ImageDecision],
    pending: bool,
    note_height: f32,
    below: usize,
    side_void: f64,
) -> Cost {
    Cost {
        side_void: if intentional {
            0.
        } else {
            120. * side_void.powi(2)
        },
        short_below_image: if intentional {
            0.
        } else {
            match below {
                1 => 12.,
                2 => 6.,
                _ => 0.,
            }
        },
        whitespace: if intentional {
            0.
        } else {
            120. * f64::from(((BOTTOM - bottom) / CAPACITY).max(0.)).powi(2)
        },
        narrow_wrap: 12. * narrow,
        widow_orphan: 18. * (orphan + f64::from(one_row)),
        image_movement: images
            .iter()
            .map(|d| 8. * f64::from(d.anchor_distance))
            .sum(),
        image_scale: images
            .iter()
            .map(|d| 30. * f64::from(1. - d.scale).powi(2))
            .sum(),
        note_split: if pending {
            3. + 8.
                * f64::from((1. - note_height / (CAPACITY * FOOTNOTE_STYLE.max_fraction)).max(0.))
        } else {
            0.
        },
        isolated_image: if lines < 3 && !images.is_empty() && !intentional {
            12.
        } else {
            0.
        },
    }
}

/// Measure empty horizontal area in portrait bands, subtracting nominal line boxes
/// and illustration rectangles. Whitespace inside landscape/cover design is intentional.
/// Normal paragraph spacing belongs to each row box; wrap gutters belong to images.
pub(super) fn side_void_fraction(images: &[ImageDecision], rows: &[[f32; 4]]) -> f64 {
    let mut empty = 0.;
    for target in images.iter().filter(|d| !d.intentional_side_space) {
        let top = target.bounds[1];
        let bottom = top + target.bounds[3];
        let mut edges = vec![top, bottom];
        for r in rows {
            if r[1] < bottom && r[1] + r[3] > top {
                edges.push(r[1].max(top));
                edges.push((r[1] + r[3]).min(bottom));
            }
        }
        edges.sort_by(f32::total_cmp);
        edges.dedup();
        for pair in edges.windows(2) {
            let y = (pair[0] + pair[1]) * 0.5;
            let mut spans = rows
                .iter()
                .filter(|r| r[1] <= y && y < r[1] + r[3])
                .map(|r| (r[0], r[0] + r[2]))
                .collect::<Vec<_>>();
            for d in images {
                let r = d.bounds;
                if r[1] <= y && y < r[1] + r[3] {
                    spans.push(((r[0] - 12.).max(LEFT), (r[0] + r[2] + 12.).min(RIGHT)));
                }
            }
            spans.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut right = LEFT;
            let mut covered = 0.;
            for (a, b) in spans {
                covered += (b.min(RIGHT) - a.max(right).max(LEFT)).max(0.);
                right = right.max(b);
            }
            empty += ((RIGHT - LEFT) - covered).max(0.) * (pair[1] - pair[0]);
        }
    }
    f64::from(empty / ((RIGHT - LEFT) * CAPACITY))
}

/// Full-width empty bands between occupied rows/images, excluding normal gutters.
/// Unlike side-void, this also catches a landscape illustration pinned to the bottom.
pub(super) fn interior_gap_height(images: &[ImageDecision], rows: &[[f32; 4]]) -> f32 {
    let mut spans: Vec<_> = rows
        .iter()
        .map(|r| (r[1], r[1] + r[3]))
        .chain(
            images
                .iter()
                .map(|i| (i.bounds[1], i.bounds[1] + i.bounds[3])),
        )
        .collect();
    spans.sort_by(|a, b| a.0.total_cmp(&b.0));
    let Some(&(_, end)) = spans.first() else {
        return 0.;
    };
    let mut bottom = end;
    let mut gap = 0.;
    for (top, end) in spans.into_iter().skip(1) {
        gap += (top - bottom - 12.).max(0.);
        bottom = bottom.max(end);
    }
    gap
}

/// A bottom-aligned float must not hide unused main-text lines beside it.
/// Space below the image is already charged by the ordinary bottom-whitespace cost.
pub(super) fn wrap_tail_height(images: &[ImageDecision], text_bottom: f32) -> f32 {
    images
        .iter()
        .filter(|d| d.side != "full" && d.side != "group")
        .map(|d| (d.bounds[1] + d.bounds[3] - text_bottom.max(d.bounds[1])).max(0.))
        .fold(0., f32::max)
}
