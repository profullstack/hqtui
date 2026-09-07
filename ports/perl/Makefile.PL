use ExtUtils::MakeMaker;
WriteMakefile(
    NAME=>'Hqtui', VERSION_FROM=>'lib/Hqtui.pm',
    ABSTRACT=>'Perl bindings to the shared HQTUI native terminal renderer',
    AUTHOR=>'Profullstack', LICENSE=>'mit',
    PREREQ_PM=>{'FFI::Platypus'=>'2.11','JSON::PP'=>0},
    MIN_PERL_VERSION=>'5.020',
);
