const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const hqtui = b.addModule("hqtui", .{
        .root_source_file = b.path("src/root.zig"),
        .target = target,
        .optimize = optimize,
    });

    // The conformance suite reads the shared fixtures from the repository, so
    // the tests need to know where the checkout is. Passing the path as a build
    // option keeps them free of assumptions about the working directory.
    const options = b.addOptions();
    options.addOptionPath("fixtures", b.path("../conformance/fixtures"));
    options.addOptionPath("demo_parity", b.path("../conformance/fixtures/demo-parity.json"));
    const fixture_options = options.createModule();

    const tests = b.addTest(.{ .root_module = hqtui });
    tests.root_module.addImport("build_options", fixture_options);
    const run_tests = b.addRunArtifact(tests);
    const test_step = b.step("test", "Run the conformance suite and dashboard regression tests");
    test_step.dependOn(&run_tests.step);

    const demo = b.addExecutable(.{
        .name = "hqtui-demo-zig",
        .root_module = b.createModule(.{
            .root_source_file = b.path("demo/main.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{.{ .name = "hqtui", .module = hqtui }},
        }),
    });
    b.installArtifact(demo);
    const run_demo = b.addRunArtifact(demo);
    if (b.args) |args| run_demo.addArgs(args);
    b.step("run-demo", "Run the native ten-screen reference demo").dependOn(&run_demo.step);
    b.step("run-dashboard", "Run the native ten-screen reference demo").dependOn(&run_demo.step);
    const demo_tests = b.addTest(.{ .root_module = demo.root_module });
    demo_tests.root_module.addImport("build_options", fixture_options);
    const run_demo_tests = b.addRunArtifact(demo_tests);
    b.step("test-demo", "Run native demo acceptance tests").dependOn(&run_demo_tests.step);
    b.getInstallStep().dependOn(&demo.step);

    // Examples are separate executables, so `zig build run-screenshot` works
    // without a TTY while `run-dashboard` takes one over.
    for ([_][]const u8{ "hello", "dashboard", "screenshot" }) |name| {
        const command_name = if (std.mem.eql(u8, name, "dashboard")) "dashboard-mini" else name;
        const exe = b.addExecutable(.{
            .name = command_name,
            .root_module = b.createModule(.{
                .root_source_file = b.path(b.fmt("examples/{s}.zig", .{name})),
                .target = target,
                .optimize = optimize,
                .imports = &.{.{ .name = "hqtui", .module = hqtui }},
            }),
        });
        b.installArtifact(exe);
        if (std.mem.eql(u8, name, "dashboard")) {
            const dashboard_tests = b.addTest(.{ .root_module = exe.root_module });
            const run_dashboard_tests = b.addRunArtifact(dashboard_tests);
            test_step.dependOn(&run_dashboard_tests.step);
        }
        const run = b.addRunArtifact(exe);
        run.step.dependOn(b.getInstallStep());
        if (b.args) |args| run.addArgs(args);
        b.step(
            b.fmt("run-{s}", .{command_name}),
            b.fmt("Run the {s} example", .{name}),
        ).dependOn(&run.step);
    }
}
