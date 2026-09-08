*> Every widget COBOL can drive, one paragraph each.
*>
*> COBOL does not link against HQTUI. It does what COBOL has always done
*> well: it writes fixed-width records. Each record is one instruction for a
*> scene, and an adapter in a modern language reads them on stdin and calls
*> the library. ports/cobol/adapter/render.ts is the TypeScript one and
*> ports/cobol/adapter/render.rs is the Rust one; the records are identical,
*> because the format is a record layout rather than an API.
*>
*>   cobc -x -free examples/widgets.cbl -o widgets
*>   ./widgets | bun adapter/render.ts
*>
*> The record is 80 columns, which is not nostalgia: it is the widest thing
*> that survives every COBOL that has ever existed, mainframe included.
*>
*>   01  SCENE-RECORD.
*>       05  SR-VERB  PIC X(9).   the instruction
*>       05  SR-KEY   PIC X(20).  a label, a level, an alignment
*>       05  SR-TEXT  PIC X(44).  content; "|" separates repeated fields
*>       05  SR-NUM   PIC X(7).   a number, as text, so no locale can eat it
*>
*> The `@widget` / `@end` markers are what hqtui.com/widgets slices to show
*> the code for one widget.

IDENTIFICATION DIVISION.
PROGRAM-ID. HQTUI-WIDGETS.

DATA DIVISION.
WORKING-STORAGE SECTION.
01  SCENE-RECORD.
    05  SR-VERB   PIC X(9)  VALUE SPACES.
    05  SR-KEY    PIC X(20) VALUE SPACES.
    05  SR-TEXT   PIC X(44) VALUE SPACES.
    05  SR-NUM    PIC X(7)  VALUE SPACES.

01  CPU-HISTORY.
    05  FILLER PIC X(60) VALUE
        "012018026022031044038052061048039044057066072064051043037041".
01  CPU-TABLE REDEFINES CPU-HISTORY.
    05  CPU-POINT PIC X(3) OCCURS 20 TIMES.

01  I             PIC 9(2) VALUE 0.

PROCEDURE DIVISION.

MAIN-PARAGRAPH.
    PERFORM TEXT-WIDGET
    PERFORM DIVIDER-WIDGET
    PERFORM KEYVALUES-WIDGET
    PERFORM TABLE-WIDGET
    PERFORM LOG-WIDGET
    PERFORM METER-WIDGET
    PERFORM GRAPH-WIDGET
    PERFORM GAUGE-WIDGET
    PERFORM BADGE-WIDGET
    PERFORM PROGRESS-WIDGET
    PERFORM SPARKLINE-WIDGET
    PERFORM HEATBAR-WIDGET
    PERFORM DONUT-WIDGET
    PERFORM LIST-WIDGET
    PERFORM TREE-WIDGET
    PERFORM BUTTON-WIDGET
    PERFORM CHECKBOX-WIDGET
    PERFORM INPUT-WIDGET
    PERFORM TABS-WIDGET
    PERFORM STATUSBAR-WIDGET
    STOP RUN.

*> Emits the current record and clears it, so a paragraph only sets the
*> fields it cares about.
EMIT-RECORD.
    DISPLAY SCENE-RECORD
    MOVE SPACES TO SR-VERB
    MOVE SPACES TO SR-KEY
    MOVE SPACES TO SR-TEXT
    MOVE SPACES TO SR-NUM.

START-WIDGET.
    MOVE "WIDGET" TO SR-VERB
    PERFORM EMIT-RECORD.

*> @widget text
TEXT-WIDGET.
    MOVE "text" TO SR-KEY
    PERFORM START-WIDGET

    MOVE "TEXT" TO SR-VERB
    MOVE "LEFT" TO SR-KEY
    MOVE "Plain text. It fills the width it is given." TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "TEXT" TO SR-VERB
    MOVE "CENTER" TO SR-KEY
    MOVE "Centered." TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "TEXT" TO SR-VERB
    MOVE "RIGHT" TO SR-KEY
    MOVE "Right aligned." TO SR-TEXT
    PERFORM EMIT-RECORD.
*> @end

*> @widget divider
DIVIDER-WIDGET.
    MOVE "divider" TO SR-KEY
    PERFORM START-WIDGET

    MOVE "TEXT" TO SR-VERB
    MOVE "Above the line" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "DIVIDER" TO SR-VERB
    PERFORM EMIT-RECORD

    MOVE "TEXT" TO SR-VERB
    MOVE "Below it" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "DIVIDER" TO SR-VERB
    MOVE "status" TO SR-TEXT
    PERFORM EMIT-RECORD.
*> @end

*> @widget keyValues
KEYVALUES-WIDGET.
    MOVE "keyValues" TO SR-KEY
    PERFORM START-WIDGET

    MOVE "KEYVALUE" TO SR-VERB
    MOVE "Host" TO SR-KEY
    MOVE "web-01.iad" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "KEYVALUE" TO SR-VERB
    MOVE "Uptime" TO SR-KEY
    MOVE "18d 04:12" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "KEYVALUE" TO SR-VERB
    MOVE "Load" TO SR-KEY
    MOVE "0.42  0.51  0.60" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "KEYVALUE" TO SR-VERB
    MOVE "Established" TO SR-KEY
    MOVE "1,284" TO SR-TEXT
    PERFORM EMIT-RECORD.
*> @end

*> @widget table
TABLE-WIDGET.
    MOVE "table" TO SR-KEY
    PERFORM START-WIDGET

    *> One COLUMN record per column; SR-KEY carries the alignment.
    MOVE "COLUMN" TO SR-VERB
    MOVE "LEFT" TO SR-KEY
    MOVE "Name" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "COLUMN" TO SR-VERB
    MOVE "RIGHT" TO SR-KEY
    MOVE "Size" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "COLUMN" TO SR-VERB
    MOVE "LEFT" TO SR-KEY
    MOVE "Type" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "COLUMN" TO SR-VERB
    MOVE "RIGHT" TO SR-KEY
    MOVE "Modified" TO SR-TEXT
    PERFORM EMIT-RECORD

    *> Cells are separated by "|", the one character no filename here uses.
    MOVE "ROW" TO SR-VERB
    MOVE "src|4.2 KB|dir|2m ago" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "ROW" TO SR-VERB
    MOVE "test|1.1 KB|dir|5m ago" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "ROW" TO SR-VERB
    MOVE "package.json|1.2 KB|file|10m ago" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "ROW" TO SR-VERB
    MOVE "README.md|3.4 KB|file|1h ago" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "SELECT" TO SR-VERB
    MOVE "1" TO SR-NUM
    PERFORM EMIT-RECORD.
*> @end

*> @widget log
LOG-WIDGET.
    MOVE "log" TO SR-KEY
    PERFORM START-WIDGET

    MOVE "LOG" TO SR-VERB
    MOVE "INFO" TO SR-KEY
    MOVE "12:45:02|listening on :8080" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "LOG" TO SR-VERB
    MOVE "WARN" TO SR-KEY
    MOVE "12:45:09|slow query 412ms|table=users" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "LOG" TO SR-VERB
    MOVE "ERROR" TO SR-KEY
    MOVE "12:45:11|upstream timeout" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "LOG" TO SR-VERB
    MOVE "INFO" TO SR-KEY
    MOVE "12:45:14|retry succeeded" TO SR-TEXT
    PERFORM EMIT-RECORD.
*> @end

*> @widget meter
METER-WIDGET.
    MOVE "meter" TO SR-KEY
    PERFORM START-WIDGET

    MOVE "METER" TO SR-VERB
    MOVE "CPU" TO SR-KEY
    MOVE "0.62" TO SR-NUM
    PERFORM EMIT-RECORD

    MOVE "METER" TO SR-VERB
    MOVE "MEM" TO SR-KEY
    MOVE "0.31" TO SR-NUM
    PERFORM EMIT-RECORD

    MOVE "METER" TO SR-VERB
    MOVE "SWP" TO SR-KEY
    MOVE "0.87" TO SR-NUM
    PERFORM EMIT-RECORD.
*> @end

*> @widget graph
GRAPH-WIDGET.
    MOVE "graph" TO SR-KEY
    PERFORM START-WIDGET

    *> One point per record, straight out of a table. This is the shape a
    *> nightly batch job already has.
    PERFORM VARYING I FROM 1 BY 1 UNTIL I > 20
        MOVE "GRAPHPT" TO SR-VERB
        MOVE CPU-POINT(I) TO SR-NUM
        PERFORM EMIT-RECORD
    END-PERFORM.
*> @end

*> @widget gauge
GAUGE-WIDGET.
    MOVE "gauge" TO SR-KEY
    PERFORM START-WIDGET

    MOVE "GAUGE" TO SR-VERB
    MOVE "62%" TO SR-TEXT
    MOVE "0.62" TO SR-NUM
    PERFORM EMIT-RECORD.
*> @end

*> @widget badge
BADGE-WIDGET.
    MOVE "badge" TO SR-KEY
    PERFORM START-WIDGET

    MOVE "BADGE" TO SR-VERB
    MOVE "active" TO SR-TEXT
    PERFORM EMIT-RECORD.
*> @end

*> @widget progress
PROGRESS-WIDGET.
    MOVE "progress" TO SR-KEY
    PERFORM START-WIDGET

    *> SR-TEXT carries the maximum, which also asks for a count readout.
    MOVE "PROGRESS" TO SR-VERB
    MOVE "Indexing" TO SR-KEY
    MOVE "120" TO SR-TEXT
    MOVE "37" TO SR-NUM
    PERFORM EMIT-RECORD

    MOVE "PROGRESS" TO SR-VERB
    MOVE "Upload" TO SR-KEY
    MOVE "0.82" TO SR-NUM
    PERFORM EMIT-RECORD.
*> @end

*> @widget sparkline
SPARKLINE-WIDGET.
    MOVE "sparkline" TO SR-KEY
    PERFORM START-WIDGET

    *> One sample per record, straight out of a table, exactly as a nightly
    *> batch job already produces them.
    PERFORM VARYING I FROM 1 BY 1 UNTIL I > 20
        MOVE "SPARKPT" TO SR-VERB
        MOVE CPU-POINT(I) TO SR-NUM
        PERFORM EMIT-RECORD
    END-PERFORM.
*> @end

*> @widget heatBar
HEATBAR-WIDGET.
    MOVE "heatBar" TO SR-KEY
    PERFORM START-WIDGET

    MOVE "HEATBAR" TO SR-VERB
    MOVE "0.28" TO SR-NUM
    PERFORM EMIT-RECORD

    MOVE "HEATBAR" TO SR-VERB
    MOVE "0.64" TO SR-NUM
    PERFORM EMIT-RECORD

    MOVE "HEATBAR" TO SR-VERB
    MOVE "0.91" TO SR-NUM
    PERFORM EMIT-RECORD.
*> @end

*> @widget donut
DONUT-WIDGET.
    MOVE "donut" TO SR-KEY
    PERFORM START-WIDGET

    MOVE "SEGMENT" TO SR-VERB
    MOVE "Used" TO SR-TEXT
    MOVE "4.65" TO SR-NUM
    PERFORM EMIT-RECORD

    MOVE "SEGMENT" TO SR-VERB
    MOVE "Free" TO SR-TEXT
    MOVE "10.96" TO SR-NUM
    PERFORM EMIT-RECORD.
*> @end

*> @widget list
LIST-WIDGET.
    MOVE "list" TO SR-KEY
    PERFORM START-WIDGET

    MOVE "ITEM" TO SR-VERB
    MOVE "apps/demo" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "ITEM" TO SR-VERB
    MOVE "packages/hqtui" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "ITEM" TO SR-VERB
    MOVE "apps/web" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "ITEM" TO SR-VERB
    MOVE "docs" TO SR-TEXT
    PERFORM EMIT-RECORD.
*> @end

*> @widget tree
TREE-WIDGET.
    MOVE "tree" TO SR-KEY
    PERFORM START-WIDGET

    *> CHILD attaches to the NODE most recently declared, so a flat record
    *> stream can still describe a hierarchy.
    MOVE "NODE" TO SR-VERB
    MOVE "systemd" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "CHILD" TO SR-VERB
    MOVE "bash" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "CHILD" TO SR-VERB
    MOVE "postgres" TO SR-TEXT
    PERFORM EMIT-RECORD.
*> @end

*> @widget button
BUTTON-WIDGET.
    MOVE "button" TO SR-KEY
    PERFORM START-WIDGET

    MOVE "BUTTON" TO SR-VERB
    MOVE "Primary" TO SR-TEXT
    PERFORM EMIT-RECORD.
*> @end

*> @widget checkbox
CHECKBOX-WIDGET.
    MOVE "checkbox" TO SR-KEY
    PERFORM START-WIDGET

    *> SR-KEY is ON or OFF: a record layout has no booleans.
    MOVE "CHECKBOX" TO SR-VERB
    MOVE "ON" TO SR-KEY
    MOVE "Toggle" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "CHECKBOX" TO SR-VERB
    MOVE "OFF" TO SR-KEY
    MOVE "Checkbox" TO SR-TEXT
    PERFORM EMIT-RECORD.
*> @end

*> @widget textInput
INPUT-WIDGET.
    MOVE "textInput" TO SR-KEY
    PERFORM START-WIDGET

    MOVE "INPUT" TO SR-VERB
    MOVE "Search" TO SR-KEY
    MOVE "postgres" TO SR-TEXT
    PERFORM EMIT-RECORD.
*> @end

*> @widget tabs
TABS-WIDGET.
    MOVE "tabs" TO SR-KEY
    PERFORM START-WIDGET

    MOVE "TAB" TO SR-VERB
    MOVE "1 dashboard" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "TAB" TO SR-VERB
    MOVE "ACTIVE" TO SR-KEY
    MOVE "2 traffic" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "TAB" TO SR-VERB
    MOVE "3 sessions" TO SR-TEXT
    PERFORM EMIT-RECORD.
*> @end

*> @widget statusBar
STATUSBAR-WIDGET.
    MOVE "statusBar" TO SR-KEY
    PERFORM START-WIDGET

    MOVE "STATUS" TO SR-VERB
    MOVE "F1" TO SR-KEY
    MOVE "Help" TO SR-TEXT
    PERFORM EMIT-RECORD

    MOVE "STATUS" TO SR-VERB
    MOVE "q" TO SR-KEY
    MOVE "Quit" TO SR-TEXT
    PERFORM EMIT-RECORD.
*> @end
