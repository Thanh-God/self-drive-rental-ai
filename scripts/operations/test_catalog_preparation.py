import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


assets, inventory = load("prepare_catalog_assets"), load("catalog_inventory")


def page():
    return {"title": "File:Toyota Corolla Cross front.jpg", "imageinfo": [{
        "thumburl": "https://thumb.wikimedia.org/car.jpg", "url": "https://upload.wikimedia.org/car.jpg",
        "descriptionurl": "https://commons.wikimedia.org/wiki/File:Car.jpg", "extmetadata": {
            "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/4.0"},
            "LicenseShortName": {"value": "CC BY-SA 4.0"}, "Artist": {"value": '<a href="/User:A">Author A</a>'}}}]}


class PreparationTests(unittest.TestCase):
    def test_credit_and_explicit_model(self):
        item = assets.candidate("Toyota Corolla Cross", page())
        self.assertEqual(item["author"], "Author A")
        self.assertIn("CC BY-SA 4.0", item["attribution"])
        self.assertIn("not the actual rental unit", item["changes"])

    def test_wrong_model_and_missing_author_refused(self):
        with self.assertRaises(ValueError):
            assets.candidate("Toyota Vios", page())
        data = page()
        del data["imageinfo"][0]["extmetadata"]["Artist"]
        with self.assertRaises(ValueError):
            assets.candidate("Toyota Corolla Cross", data)

    def test_unsupported_or_missing_license_refused(self):
        for url in ["", "https://creativecommons.org/licenses/by-nc/4.0", "https://other.example/by-sa/4.0"]:
            data = page()
            data["imageinfo"][0]["extmetadata"]["LicenseUrl"]["value"] = url
            with self.assertRaises(ValueError):
                assets.candidate("Toyota Corolla Cross", data)

    def test_official_thumbnail_hosts_only(self):
        for host, allowed in [("upload.wikimedia.org", True), ("thumb.wikimedia.org", True), ("example.org", False)]:
            data = copy.deepcopy(page())
            data["imageinfo"][0]["thumburl"] = "https://" + host + "/photo.jpg"
            if allowed:
                assets.candidate("Toyota Corolla Cross", data)
            else:
                with self.assertRaises(ValueError):
                    assets.candidate("Toyota Corolla Cross", data)

    def test_inventory_wrong_target_refused_before_docker(self):
        with patch.object(inventory.subprocess, "run") as run:
            with self.assertRaises(ValueError):
                inventory.inventory("quiz_mysql")
            run.assert_not_called()

    def test_inventory_identity_drift_refuses_before_sql(self):
        with patch.object(inventory.subprocess, "run") as run:
            run.return_value.stdout = b"other|true"
            with self.assertRaises(ValueError):
                inventory.inventory()
            self.assertEqual(run.call_count, 1)


if __name__ == "__main__":
    unittest.main()
