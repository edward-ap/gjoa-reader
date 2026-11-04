use super::{Item, PageLayout};

/// An image-only opening page is a cover: use the entire sheet, without
/// cropping or changing its aspect ratio. Other pages retain their layout.
pub(super) fn fit(page: &mut PageLayout, index: usize) {
    if index != 0 {
        return;
    }
    let [Item::Image { bounds, .. }] = page.items.as_mut_slice() else {
        return;
    };
    let [_, _, width, height] = *bounds;
    if width <= 0. || height <= 0. || !width.is_finite() || !height.is_finite() {
        return;
    }
    let w = page.width as f32;
    let h = page.height as f32;
    let scale = (w / width).min(h / height);
    let width = width * scale;
    let height = height * scale;
    *bounds = [(w - width) / 2., (h - height) / 2., width, height];
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opening_cover_fits_sheet_and_other_content_is_unchanged() {
        for (width, height) in [(200., 320.), (320., 200.), (1600., 2240.)] {
            let mut page = PageLayout {
                width: 800,
                height: 1120,
                items: vec![Item::Image {
                    asset: "cover.png".into(),
                    bounds: [72., 72., width, height],
                }],
            };
            let original = serde_json::to_vec(&page).unwrap();
            fit(&mut page, 1);
            assert_eq!(serde_json::to_vec(&page).unwrap(), original);
            fit(&mut page, 0);
            let Item::Image {
                bounds: [x, y, w, h],
                ..
            } = page.items[0]
            else {
                panic!()
            };
            assert!((w / h - width / height).abs() < 0.0001);
            assert!((w - 800.).abs() < 0.001 || (h - 1120.).abs() < 0.001);
            assert!(x >= 0. && y >= 0. && x + w <= 800.001 && y + h <= 1120.001);
            page.items.push(Item::Rule {
                bounds: [72., 500., 656., 0.75],
            });
            let mixed = serde_json::to_vec(&page).unwrap();
            fit(&mut page, 0);
            assert_eq!(serde_json::to_vec(&page).unwrap(), mixed);
        }
    }
}
