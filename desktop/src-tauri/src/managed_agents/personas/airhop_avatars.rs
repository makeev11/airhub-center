use std::sync::LazyLock;

use base64::{engine::general_purpose::STANDARD, Engine as _};

// Share the exact product artwork with the frontend; do not inherit Buzz's
// Honey/Bumble avatars for newly provisioned AirHop roles.
static AVATARS: LazyLock<[String; 4]> = LazyLock::new(|| {
    [
        include_bytes!("../../../../public/agents/fizz.png").as_slice(),
        include_bytes!("../../../../public/agents/administrator.png").as_slice(),
        include_bytes!("../../../../public/agents/analyst.png").as_slice(),
        include_bytes!("../../../../public/agents/editor.png").as_slice(),
    ]
    .map(|bytes| format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
});

pub(super) fn avatar(id: &str) -> Option<&'static str> {
    let index = match id {
        "builtin:airhop-fizz" => 0,
        "builtin:airhop-administrator" => 1,
        "builtin:airhop-analyst" => 2,
        "builtin:airhop-content-marketer" => 3,
        _ => return None,
    };
    Some(AVATARS[index].as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn product_roles_use_distinct_bundled_artwork() {
        let unique: std::collections::HashSet<_> = AVATARS.iter().collect();
        assert_eq!(unique.len(), 4);
        for image in AVATARS.iter() {
            assert!(image.starts_with("data:image/png;base64,iVBOR"));
        }
        assert!(avatar("builtin:honey").is_none());
    }
}
