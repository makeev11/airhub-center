use super::LegacyBuiltInAvatar;

pub(super) const LEGACY_BUILTIN_AVATARS: &[LegacyBuiltInAvatar<'static>] = &[
    // AirHop originally reused the Buzz artwork. Match only those exact seeded
    // bytes/uploads, so a user-provided avatar is never overwritten.
    LegacyBuiltInAvatar {
        persona_id: "builtin:airhop-fizz",
        data_url_sha256: "6cdf8c338d27ef3c9dd68cf4839f3d62dec2298e2d4e07b851f26f8ba289b377",
        sanitized_media_sha256: "e6025a21c864750f4b3828c9035bafdbe68ec73bd247745c78309b82fedcbed5",
        persona_content_hash: "",
    },
    LegacyBuiltInAvatar {
        persona_id: "builtin:airhop-administrator",
        data_url_sha256: "7b51bb3e353aed13b5d6a01d0ad9aa58d63b6bb347f2ed6ee891e7af6149febe",
        sanitized_media_sha256: "4a64f32d2375ccfe44c0880416bc72b809b055f0fb7d9dddeb8bb3dd6b80c297",
        persona_content_hash: "",
    },
    LegacyBuiltInAvatar {
        persona_id: "builtin:airhop-analyst",
        data_url_sha256: "9e1e841a76069202474393b786ada0628d90711703f8ba96c9ecee84a1c6a593",
        sanitized_media_sha256: "99d32de5791ec07db70c761db30fd145422e6c8200ba8d189363c3ce53273758",
        persona_content_hash: "",
    },
    LegacyBuiltInAvatar {
        persona_id: "builtin:airhop-content-marketer",
        data_url_sha256: "7b51bb3e353aed13b5d6a01d0ad9aa58d63b6bb347f2ed6ee891e7af6149febe",
        sanitized_media_sha256: "4a64f32d2375ccfe44c0880416bc72b809b055f0fb7d9dddeb8bb3dd6b80c297",
        persona_content_hash: "",
    },
    LegacyBuiltInAvatar {
        persona_id: "builtin:fizz",
        data_url_sha256: "2771b8c9c46aa3c8ac1c4d2acfa23fa9ba35b79c4b1694554e923081e3b8b4d0",
        sanitized_media_sha256: "1a4964ff4cf6c499df1a77a941c211c7d1e7ef755f1c395bc9a3b0f2878114a6",
        persona_content_hash: "b36381d042c8eb5c786a1a692c7ba5a47ae129b9972a1473b64d8fe03f4817c1",
    },
    LegacyBuiltInAvatar {
        persona_id: "builtin:honey",
        data_url_sha256: "1979e54ef77fc94ec688170bd74dade35c563e7fcc82bb0714c672dfb018eab9",
        sanitized_media_sha256: "0e0ed9a35d4050bdd290aa8138d5ab811f222549f6acc3cee40a7feb65933e1f",
        persona_content_hash: "9c9b6b11f1cdd56ba645de02213c562e59c3690bf3f217f74a85df8e6575fd06",
    },
    LegacyBuiltInAvatar {
        persona_id: "builtin:bumble",
        data_url_sha256: "c08cf3b8b4c3f8721df6143367ababdebae8f913b9c654401ba74bb3d233655b",
        sanitized_media_sha256: "9f798c61f8965b80beb808f505feb0a5b33726545188ea8212cc9ab22d05f0b6",
        persona_content_hash: "544a73f9106a3c8848b0f308b7a8b6f95077ac8deccdb9ed5552caa833d66c95",
    },
];
