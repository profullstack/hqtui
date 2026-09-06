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

    const tests = b.addTest(.{ .root_module = hqtui });
    tests.root_module.addOptions("build_options", options);
    const run_tests = b.addRunArtifact(tests);
    const test_step = b.step("test", "Run the conformance suite and dashboard regression tests");
    test_step.dependOn(&run_tests.step);

    // Examples are separate executables, so `zig build run-screenshot` works
    // without a TTY while `run-dashboard` takes one over.
    for ([_][]const u8{ "hello", "dashboard", "screenshot" }) |name| {
        const exe = b.addExecutable(.{
            .name = name,
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
            b.fmt("run-{s}", .{name}),
            b.fmt("Run the {s} example", .{name}),
        ).dependOn(&run.step);
    }
}
