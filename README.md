# usage-bar

A Claude Code mod that shows, above the message box, a line with how full the context, session (5h) and weekly usage limits are, with the time left before they reset.
<img width="858" height="162" alt="image" src="https://github.com/user-attachments/assets/491f01c6-443c-4c9d-8e74-12dbf9dc3cc3" />
<img width="860" height="161" alt="image" src="https://github.com/user-attachments/assets/8cdef9f7-fb50-457c-ad5d-03ffabf5a766" />

Context shows its percentage, what the last turn added and the tokens used out of the window. The gauges turn yellow at 70 % and red at 90 %. While Claude is working, a wave runs across the bar. The `/usage-bar` command shows or hides the bar.

An **optional** stats line can be shown above the bar:

<img width="692" height="153" alt="Screenshot 2026-10-23 at 14 48 45" src="https://github.com/user-attachments/assets/462fc1e5-3bc7-4fd0-8136-37935522c028" />

It shows how long the last turn took, how many tools it used, the tokens sent and received, and what it cost, followed by the total cost of the conversation (the same as `/cost`). While Claude is working, the duration and tool count update live.

Costs are estimates at API list prices; with a Claude subscription, they are not what you are billed.

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

# Options

Both options can be set from **Manage Plugins** (`/plugin`, then usage-bar, then Configure), or in your `~/.claude/settings.json` as shown below.

## Change the color

The accent color is orange by default. It accepts:

- a hex code, such as `#4ec98a`;
- a color name: `orange`, `green`, `blue`, `purple`, `pink`, `teal`, `lavender` or `peach`;
- `random`, for a new color at each message, never the same twice in a row.

```json
"pluginConfigs": {
  "usage-bar@claude-usage-bar": { "options": { "accent": "green" } }
}
```
## Show the stats line

The stats line is hidden by default. To show it, add `showStats` to your `~/.claude/settings.json`:

```json
"pluginConfigs": {
  "usage-bar@claude-usage-bar": { "options": { "showStats": true } }
}
```

