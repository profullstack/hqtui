package hqtui

// Emoji for terminals: Emoji("fire") is 🔥 where the terminal draws emoji and
// "[fire]" where it cannot.
//
// The built-in pack is OpenEmoji (https://logicsrc.com/openemoji), on by
// default, generated into emoji_data.go from the same set as the TypeScript
// reference. A name can be the shortcode with or without oe_ and colons, the
// CLDR name, a common alias (thumbsup, +1, heart) or the emoji itself. Which
// you get: SetEmojiMode if the app chose; HQTUI_EMOJI=emoji|text; otherwise
// emoji where the terminal draws Unicode and is not the Linux console, and
// text elsewhere. Text is an emoticon where one fits (:) <3 :D) and the name
// in brackets elsewhere. StringWidth counts every emoji here as two columns.

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// EmojiMode picks the emoji or its text.
type EmojiMode string

const (
	EmojiModeEmoji EmojiMode = "emoji"
	EmojiModeText  EmojiMode = "text"
)

// EmojiInfo is everything the built-in pack knows about one emoji.
type EmojiInfo struct {
	Key       string // fully-qualified codepoints, lowercase hex, hyphen-joined
	Char      string
	Name      string // CLDR short name
	Shortcode string // oe_ included
	Group     string
	Keywords  []string
	Base      string // the toneless emoji a skin-tone variant belongs to
}

var (
	emojiMu      sync.RWMutex
	emojiChosen  EmojiMode
	emojiLoaded  sync.Once
	emojiByKey   map[string]*EmojiInfo
	emojiByName  map[string]string
	emojiByChar  map[string]string
	emojiAll     []*EmojiInfo
	emojiToneKey = []string{"1f3fb", "1f3fc", "1f3fd", "1f3fe", "1f3ff"}
	emojiToneNm  = []string{"light", "medium-light", "medium", "medium-dark", "dark"}
	slugPattern  = regexp.MustCompile(`[^a-z0-9]+`)
	emojifyRe    = regexp.MustCompile(`(?i):([a-z0-9_+-]+):`)
)

// EmojiSlug is the shortcode a name reduces to; rows store theirs only when it differs.
func EmojiSlug(name string) string {
	return strings.Trim(slugPattern.ReplaceAllString(strings.ToLower(name), "_"), "_")
}

func emojiChar(key string) string {
	var b strings.Builder
	for _, h := range strings.Split(key, "-") {
		cp, err := strconv.ParseUint(h, 16, 32)
		if err == nil {
			b.WriteRune(rune(cp))
		}
	}
	return b.String()
}

func toneIndex(cp string) int {
	for i, t := range emojiToneKey {
		if t == cp {
			return i
		}
	}
	return -1
}

func loadEmoji() {
	emojiLoaded.Do(func() {
		emojiByKey = make(map[string]*EmojiInfo, len(openEmojiRows)+len(openEmojiToned))
		for _, r := range openEmojiRows {
			short := r.short
			if short == "" {
				short = EmojiSlug(r.name)
			}
			var kw []string
			if r.keywords != "" {
				kw = strings.Split(r.keywords, " ")
			}
			group := ""
			if r.group < len(openEmojiGroups) {
				group = openEmojiGroups[r.group]
			}
			emojiByKey[r.key] = &EmojiInfo{Key: r.key, Char: emojiChar(r.key), Name: r.name, Shortcode: "oe_" + short, Group: group, Keywords: kw}
		}
		for _, t := range openEmojiToned {
			base, ok := emojiByKey[t[1]]
			if !ok {
				continue
			}
			var tones []int
			for _, cp := range strings.Split(t[0], "-") {
				if i := toneIndex(cp); i >= 0 {
					tones = append(tones, i)
				}
			}
			names := make([]string, len(tones))
			codes := make([]string, len(tones))
			for i, tone := range tones {
				names[i] = emojiToneNm[tone] + " skin tone"
				codes[i] = "t" + strconv.Itoa(tone+1)
			}
			sep := ": "
			if strings.Contains(base.Name, ":") {
				sep = ", "
			}
			emojiByKey[t[0]] = &EmojiInfo{
				Key: t[0], Char: emojiChar(t[0]), Name: base.Name + sep + strings.Join(names, ", "),
				Shortcode: base.Shortcode + "_" + strings.Join(codes, "_"), Group: base.Group, Keywords: base.Keywords, Base: base.Key,
			}
		}
		emojiByName = make(map[string]string, len(emojiByKey)*3)
		emojiByChar = make(map[string]string, len(emojiByKey)*2)
		keys := make([]string, 0, len(emojiByKey))
		for k := range emojiByKey {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			e := emojiByKey[k]
			emojiAll = append(emojiAll, e)
			emojiByName[e.Shortcode] = k
			emojiByName[e.Shortcode[3:]] = k
			emojiByName[strings.ToLower(e.Name)] = k
			emojiByChar[e.Char] = k
			emojiByChar[strings.ReplaceAll(e.Char, "️", "")] = k
		}
		for alias, k := range openEmojiAliases {
			if _, taken := emojiByName[alias]; !taken {
				emojiByName[alias] = k
			}
		}
	})
}

// EmojiInfoOf looks an emoji up by any name it answers to.
func EmojiInfoOf(name string) (EmojiInfo, bool) {
	loadEmoji()
	trimmed := strings.TrimSpace(name)
	bare := strings.ToLower(strings.TrimSuffix(strings.TrimPrefix(trimmed, ":"), ":"))
	candidates := []string{emojiByName[bare], emojiByName[strings.Join(strings.FieldsFunc(bare, func(r rune) bool { return r == ' ' || r == '-' }), "_")], emojiByChar[trimmed], emojiByChar[strings.ReplaceAll(trimmed, "️", "")]}
	for _, k := range candidates {
		if e, ok := emojiByKey[k]; ok && k != "" {
			return *e, true
		}
	}
	if e, ok := emojiByKey[bare]; ok {
		return *e, true
	}
	return EmojiInfo{}, false
}

// SetEmojiMode pins emoji or text for the whole app; "" detects again.
func SetEmojiMode(mode EmojiMode) {
	emojiMu.Lock()
	emojiChosen = mode
	emojiMu.Unlock()
}

// EmojiModeIn is what an environment gets, in the order at the top of this file.
func EmojiModeIn(env Env, windows bool) EmojiMode {
	emojiMu.RLock()
	chosen := emojiChosen
	emojiMu.RUnlock()
	if chosen != "" {
		return chosen
	}
	switch EmojiMode(env.get("HQTUI_EMOJI")) {
	case EmojiModeEmoji:
		return EmojiModeEmoji
	case EmojiModeText:
		return EmojiModeText
	}
	// The Linux virtual console speaks UTF-8 but its font has no emoji.
	if env.get("TERM") == "linux" {
		return EmojiModeText
	}
	if detectUnicode(env, windows) {
		return EmojiModeEmoji
	}
	return EmojiModeText
}

// EmojiText is an emoji as text: an emoticon, or its name in brackets.
func EmojiText(name string) string {
	e, ok := EmojiInfoOf(name)
	if !ok {
		return ""
	}
	if t, ok := openEmojiEmoticons[e.Key]; ok {
		return t
	}
	if t, ok := openEmojiEmoticons[e.Base]; ok && e.Base != "" {
		return t
	}
	return "[" + e.Name + "]"
}

// EmojiIn is an emoji in a given mode. Unknown names return "".
func EmojiIn(name string, mode EmojiMode) string {
	e, ok := EmojiInfoOf(name)
	if !ok {
		return ""
	}
	if mode == EmojiModeEmoji {
		return e.Char
	}
	return EmojiText(e.Key)
}

// Emoji is the emoji, or its text, in this process's terminal.
func Emoji(name string) string {
	return EmojiIn(name, EmojiModeIn(ProcessEnv(), runningOnWindows()))
}

// EmojifyIn replaces every :name: in text; anything that is not an emoji stays.
func EmojifyIn(text string, mode EmojiMode) string {
	return emojifyRe.ReplaceAllStringFunc(text, func(whole string) string {
		if out := EmojiIn(whole[1:len(whole)-1], mode); out != "" {
			return out
		}
		return whole
	})
}

// Emojify replaces every :name: in text for this process's terminal.
func Emojify(text string) string {
	return EmojifyIn(text, EmojiModeIn(ProcessEnv(), runningOnWindows()))
}

// EmojiSearch lists emoji matching every word of the query, best first.
func EmojiSearch(query string, limit int) []EmojiInfo {
	loadEmoji()
	q := strings.ToLower(strings.Trim(strings.TrimSpace(query), ":"))
	if q == "" {
		return nil
	}
	words := strings.FieldsFunc(q, func(r rune) bool { return r == ' ' || r == '_' })
	exact, hasExact := EmojiInfoOf(q)
	type hit struct {
		score int
		e     *EmojiInfo
	}
	var hits []hit
	for _, e := range emojiAll {
		if e.Base != "" {
			continue
		}
		hay := strings.ToLower(e.Name + " " + e.Shortcode + " " + strings.Join(e.Keywords, " "))
		all := true
		for _, w := range words {
			if !strings.Contains(hay, w) {
				all = false
				break
			}
		}
		if !all {
			continue
		}
		name := strings.ToLower(e.Name)
		score := 4
		switch {
		case hasExact && e.Key == exact.Key:
			score = 0
		case containsWord(name, q):
			score = 1
		case strings.HasPrefix(name, q):
			score = 2
		case strings.Contains(name, q):
			score = 3
		}
		hits = append(hits, hit{score, e})
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].score != hits[j].score {
			return hits[i].score < hits[j].score
		}
		return len(hits[i].e.Name) < len(hits[j].e.Name)
	})
	if limit > 0 && len(hits) > limit {
		hits = hits[:limit]
	}
	out := make([]EmojiInfo, len(hits))
	for i, h := range hits {
		out[i] = *h.e
	}
	return out
}

func containsWord(name, word string) bool {
	for _, w := range slugPattern.Split(name, -1) {
		if w == word {
			return true
		}
	}
	return false
}

// EmojiNames lists every shortcode in the built-in pack, sorted.
func EmojiNames() []string {
	loadEmoji()
	names := make([]string, len(emojiAll))
	for i, e := range emojiAll {
		names[i] = e.Shortcode
	}
	sort.Strings(names)
	return names
}
