# usage-bar

Mod Claude Code qui affiche, au-dessus de la zone de message, une ligne avec le remplissage du contexte et les limites d'usage 5h et semaine, avec le temps avant leur remise à zéro.

```
Context ▬▬▬▬▬▬▬▬ 9%   5h ▬▬▬▬▬▬▬▬ 7% (↻ 04h33)   Week ▬▬▬▬▬▬▬▬ 70% (↻ 18h03)
```

Les jauges passent en jaune à 70 % et en rouge à 90 %. La commande `/usage-bar` affiche ou masque le bandeau.

## Installation

Dans une session Claude Code (terminal) :

```
/plugin install usage-bar --marketplace M-Jeremy/claude-usage-bar
```

Répondre `y` pour ajouter le marketplace, puis choisir une portée.

Depuis un shell :

```
claude plugin install usage-bar --marketplace M-Jeremy/claude-usage-bar
```

Dans l'application de bureau : cliquer sur + à côté du champ de message, puis Plugins, Add marketplace avec `M-Jeremy/usage-bar`, puis Add plugin.
