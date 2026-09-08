//! Widgets draw straight onto a [`Surface`](crate::surface::Surface). The
//! builder in [`ui`](crate::ui) wraps every one of these with layout, so reach
//! for these directly only when you are drawing inside a `draw` escape hatch.

pub mod calendar;
pub mod chart;
pub mod controls;
pub mod meters;
pub mod scrollbar;
pub mod surface;
pub mod table;
pub mod text;

pub use controls::{
    draw_button, draw_checkbox, draw_command_palette, draw_modal, draw_select, draw_tabs,
    draw_text_input, draw_tooltip, ButtonOptions, ButtonVariant, CheckboxOptions,
    CheckboxVariant, CommandPaletteOptions, ModalButton, ModalOptions, PaletteItem,
    SelectOptions, TabVariant, TabsOptions, TextInputOptions, TooltipOptions,
};
pub use meters::{
    clamp_ratio, draw_columns, draw_donut, draw_gauge, draw_graph, draw_heat_bar, draw_meter,
    draw_meters, draw_progress, draw_sparkline, nice_label, ColumnsOptions, DonutOptions,
    DonutSegment, GaugeOptions, GraphOptions, HeatBarOptions, MeterItem, MeterOptions,
    MetersOptions, ProgressOptions, SparklineWidgetOptions,
};
pub use calendar::{
    calendar_height, day_of_week, days_in_month, draw_calendar, is_leap_year, CalendarMark,
    CalendarOptions,
};
pub use chart::{draw_chart, ChartOptions};
pub use scrollbar::{
    draw_scrollbar, draw_scrollbar_widget, offset_for_position, thumb, thumb_of, ScrollbarOptions,
    ScrollbarOrientation,
};
pub use surface::{draw_clear, draw_fill, ClearOptions, FillOptions};
pub use table::{
    draw_list, draw_log, draw_table, draw_tree, resolve_offset, TableColumn,
    ListItem, ListOptions, LogEntry, LogOptions, TableOptions, TableRow, TreeNode, TreeOptions,
    TreeValue,
};
pub use text::{
    draw_badge, draw_divider, draw_key_values, draw_status_bar, draw_text, BadgeOptions,
    BadgeVariant, DividerOptions, KeyStyle, KeyValueOptions, KeyValueRow, StatusBarOptions,
    StatusItem, TextStyle,
};
