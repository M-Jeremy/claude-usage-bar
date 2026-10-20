# usage-bar

A Claude Code mod that shows, above the message box, a line with how full the context is and the session (5h) and weekly usage limits, with the time left before they reset.

```
Context 37% +4% (74k / 200k)  Session •••••••••••••••••• 15% (↻ 03h46)  Week •••••••••••••••••• 24% (↻ 65h26)
```

Context shows its percentage, what the last turn added and the tokens used out of the window. The gauges turn yellow at 70 % and red at 90 %. While Claude is working, a wave runs across the bar. The `/usage-bar` command shows or hides the bar.

## Installation

In a Claude Code session (terminal):

```
/plugin install usage-bar --marketplace M-Jeremy/claude-usage-bar
```

Answer `y` to add the marketplace, then choose a scope.

**OR**

From a shell:

```
claude plugin install usage-bar --marketplace M-Jeremy/claude-usage-bar
```

**OR**

In the desktop app: click + next to the message box, then Plugins, Add marketplace with `M-Jeremy/claude-usage-bar`, then Add plugin.

## Change the color

The accent color is orange by default. To change it, add this to your `~/.claude/settings.json`, with the color of your choice as a hex code:

```json
"pluginConfigs": {
  "usage-bar@claude-usage-bar": { "options": { "accent": "#4ec98a" } }
}
```
