//! Bounded row candidates for consecutive illustrations, in source order.
use super::*;

impl Engine<'_, '_> {
    fn sequence_pair(&self, a: usize, b: usize) -> bool {
        b == a + 1
            && [a, b]
                .iter()
                .all(|i| self.images.get(i).is_some_and(|v| !v.cover))
            && !self
                .model
                .structure
                .iter()
                .any(|s| s.chapter && s.block == b)
    }

    pub(super) fn in_image_sequence(&self, block: usize) -> bool {
        self.sequence_pair(block, block + 1)
            || block
                .checked_sub(1)
                .is_some_and(|previous| self.sequence_pair(previous, block))
    }

    pub(super) fn image_policies(&self, block: usize) -> Vec<Policy> {
        let mut result = vec![];
        if self.image_groups {
            for count in [2, 3] {
                if self
                    .image_group(block, count, TOP, &[], &Boundary::default())
                    .is_ok()
                {
                    result.push(Policy {
                        id: count + 12,
                        ..policies()[0]
                    });
                }
            }
        }
        result.extend(policies().into_iter().filter(|p| p.reserve == 0));
        result
    }

    pub(super) fn image_group(
        &self,
        block: usize,
        count: usize,
        y: f32,
        occupied: &[[f32; 4]],
        state: &Boundary,
    ) -> Result<Vec<(Item, ImageDecision)>> {
        if !(2..=3).contains(&count)
            || !(block..block + count - 1).all(|i| self.sequence_pair(i, i + 1))
            || (block..block + count).any(|i| state.placed.contains(&i))
            || !state.carried.is_empty()
        {
            return Err("not an unbroken illustration group".into());
        }
        let images: Vec<_> = (block..block + count).map(|i| &self.images[&i]).collect();
        let ratio: f32 = images.iter().map(|i| i.intrinsic[0] / i.intrinsic[1]).sum();
        let gutter = 12.;
        let top = occupied
            .iter()
            .map(|r| r[1] + r[3] + gutter)
            .fold(y, f32::max);
        let height = ((RIGHT - LEFT - gutter * (count - 1) as f32) / ratio)
            .min(BOTTOM - top)
            .min(
                images
                    .iter()
                    .map(|i| i.layout.preferred[1])
                    .fold(f32::INFINITY, f32::min),
            );
        if !height.is_finite() || height <= 0. || top < TOP {
            return Err("illustration group outside content bounds".into());
        }
        let width = height * ratio + gutter * (count - 1) as f32;
        let mut x = (LEFT + RIGHT - width) / 2.;
        let mut result = vec![];
        for (index, image) in images.into_iter().enumerate() {
            let w = height * image.intrinsic[0] / image.intrinsic[1];
            if w + 0.01 < image.layout.minimum[0] || height + 0.01 < image.layout.minimum[1] {
                return Err("illustration group below minimum size".into());
            }
            let bounds = [x, top, w, height];
            result.push((
                Item::Image {
                    asset: image.asset.clone(),
                    bounds,
                },
                ImageDecision {
                    block: block + index,
                    bounds,
                    scale: w / image.layout.preferred[0],
                    side: "group".into(),
                    anchor_distance: ((top - y) / CAPACITY).abs(),
                    policy: count + 12,
                    intentional_side_space: true,
                },
            ));
            x += w + gutter;
        }
        Ok(result)
    }
}
