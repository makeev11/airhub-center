//! Public, provider-owned map links derived from an authoritative branch address.

use serde_json::{json, Value};

pub(super) fn branch_map_links(address: &str) -> Value {
    let encoded =
        url::form_urlencoded::byte_serialize(address.trim().as_bytes()).collect::<String>();
    json!([
        {
            "provider": "yandex_maps",
            "url": format!("https://yandex.ru/maps/?text={encoded}"),
        },
        {
            "provider": "google_maps",
            "url": format!("https://www.google.com/maps/search/?api=1&query={encoded}"),
        },
        {
            "provider": "two_gis",
            "url": format!("https://2gis.ru/search/{encoded}"),
        },
    ])
}

pub(super) fn enrich_conversation_routing(mut routing: Value) -> Value {
    let selected_branch_id = routing
        .get("branchId")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let Some(branches) = routing.get_mut("branches").and_then(Value::as_array_mut) else {
        return routing;
    };
    let mut selected_address = None;
    let mut selected_links = None;
    for branch in branches {
        let Some(object) = branch.as_object_mut() else {
            continue;
        };
        let Some(address) = object
            .get("address")
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            continue;
        };
        let links = branch_map_links(&address);
        object.insert("mapLinks".to_owned(), links.clone());
        if object.get("id").and_then(Value::as_str) == selected_branch_id.as_deref() {
            selected_address = Some(address);
            selected_links = Some(links);
        }
    }
    let Some(object) = routing.as_object_mut() else {
        return routing;
    };
    if let Some(address) = selected_address {
        object.insert("branchAddress".to_owned(), json!(address));
    }
    if let Some(links) = selected_links {
        object.insert("mapLinks".to_owned(), links);
    }
    routing
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_encode_one_address_for_every_provider() {
        let links = branch_map_links(" Москва, Земляной Вал, 9 ");
        let links = links.as_array().unwrap();
        assert_eq!(links.len(), 3);
        assert!(links.iter().all(|link| link["url"]
            .as_str()
            .unwrap()
            .contains("%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0")));
    }

    #[test]
    fn routing_exposes_the_selected_branch_location() {
        let routing = enrich_conversation_routing(json!({
            "branchId": "branch-1",
            "branches": [
                {"id": "branch-1", "name": "Центр", "address": "Москва"},
                {"id": "branch-2", "name": "Север", "address": "Химки"}
            ]
        }));
        assert_eq!(routing["branchAddress"], "Москва");
        assert_eq!(routing["mapLinks"].as_array().unwrap().len(), 3);
        assert_eq!(
            routing["branches"][1]["mapLinks"].as_array().unwrap().len(),
            3
        );
    }
}
