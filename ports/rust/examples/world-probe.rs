//! Prints what the country lookup answers for a fixed set of points.
//!
//! The same probe exists for every port, so "the ports agree about the world"
//! is a diff rather than a hope.
use hqtui::graphics::{country_at, degrees_at, WORLD_X, WORLD_Y};
use hqtui::widgets::{country_at_cell, WorldMapOptions};

fn main() {
    let places: [(&str, f64, f64); 13] = [
        ("Paris", 2.35, 48.86),
        ("Tokyo", 139.7, 35.7),
        ("Cairo", 31.2, 30.0),
        ("Brasilia", -47.9, -15.8),
        ("Canberra", 149.1, -35.3),
        ("Denver", -105.0, 39.7),
        ("Moscow", 37.6, 55.75),
        ("Delhi", 77.2, 28.6),
        ("Nairobi", 36.8, -1.3),
        ("Pacific", -140.0, 0.0),
        ("Atlantic", -30.0, 0.0),
        ("SouthernOcean", 80.0, -40.0),
        ("NorthPacific", -150.0, 40.0),
    ];
    for (name, lon, lat) in places {
        let found = country_at(lon, lat).map(|c| c.name).unwrap_or("-");
        println!("{name} {found}");
    }

    // The cell path, which has to agree with what the canvas drew.
    let options = WorldMapOptions::default();
    for (column, row) in [(173usize, 28usize), (74, 2), (20, 25), (88, 7)] {
        let found = country_at_cell(column, row, 200, 50, &options).map(|c| c.name).unwrap_or("-");
        println!("cell:{column},{row} {found}");
    }

    // And the projection itself, so a drift shows up as a number rather than as
    // a country that happens to still be right.
    for (column, row) in [(0usize, 0usize), (99, 25), (50, 13)] {
        let (lon, lat) = degrees_at(column, row, 100, 26, WORLD_X, WORLD_Y).unwrap();
        println!("degrees:{column},{row} {lon:.4} {lat:.4}");
    }
}
