# What makes collecting and trading hold a player

This file is for the maintainers and the agents working on this repo. It is research, not a skill: it is not published (`package.json` `files` leaves `genres/` out), and no skill reads it yet. It collects the principles behind games where the player gathers a set of things (creatures, cards, items, cosmetics) and swaps them with other players: what makes someone start, what keeps them collecting, and what makes a digital thing feel valuable when it could be copied for free. It is written for a 2D game a small indie team can build. A later skill or playbook can quote it the way [`PROTOTYPE.md`](../PROTOTYPE.md) backs `ritmo-prototype`.

It builds on [`RPG.md`](RPG.md), which already covers variable rewards and the loot "slot machine", the goal gradient (players speed up near a goal), and value chains (every resource leads to something the player wants). Those are not repeated here; this file is about the collection itself and the things in it.

Each principle is stated first, then the sources behind it, quoted with a link. Most have two or more sources of different kinds (designers of shipped collecting and trading games, people who ran game economies, and published psychology and economics). Where a principle is our own reading of several sources, it says so.

Quotes were checked against the text of the linked page on 2026-11-01, read through a fetch tool (the pages could not be downloaded directly), by asking whether the exact string was on the page. A quote marked "via" was checked on that secondary page, not in the original. Two sources are translations or notes and say so: the 1996 Tajiri interview is a fan translation, and the 2008 GDC talk on EVE's economy is a blogger's notes, not a transcript.

## Where the sources disagree

- **Paid randomness.** Opening a pack is part of the fun: Garfield says "It's exciting to bust packs open", and when Legends of Runeterra's testers had no packs they "missed the satisfaction of building their collection, or the thrill of pulling an exciting card." But a survey of 7,422 players links loot box spending to problem gambling, more strongly than other in-game spending, and Riot calls "paid random packs" "the root of many issues". Riot's answer is the one we take: keep the thrill of the pull, never sell it. See [Never sell the pull](#14-never-sell-the-pull).
- **Trading.** Pokémon began as a game about trading ("it was 'we want to trade.'"). Marvel Snap, from Hearthstone's former game director, left trading out: "Trading would be rad!", but the game gives players a way to make copies, "which breaks the 'trading' market because increasing supply is essentially free." Both are right: trading needs things that are scarce in each player's game and cannot be made from currency. A game whose items can be crafted at will should not add trading. See [Trading starts from difference](#10-trading-starts-from-difference).
- **Scarcity in time.** Things are valued more when scarce, and most when they become scarce; TF2's lead says players care about rare items "because they're rare." Yet limited-time content, the most common way to make a digital thing scarce, "manipulates consumers into putting more value on something", and dark-pattern research counts "Play by Appointment" among patterns that make players feel worse. We keep scarcity in place, effort, and other players' games, not in a window that closes forever. See [Scarcity is real, and it has a reason](#8-scarcity-is-real-and-it-has-a-reason).

## The principles in one list

1. Give the player something at once, and let them pick it.
2. Show the whole set, gaps and all, and make it finite.
3. Collecting is for showing: build the shelf and the visit.
4. Every item does something, looks like something, or says something about its owner.
5. An item remembers where it came from.
6. Effort is the price, and finishing is what makes it count.
7. A duplicate is never a dead pull.
8. Scarcity is real, and it has a reason.
9. Status needs an audience.
10. Trading starts from difference.
11. An economy needs sinks, or everything becomes worthless.
12. Barter is clumsy: give trades a medium, or keep them one-on-one.
13. Keep trading inside the game, never for money.
14. Never sell the pull.

## The first hour: what makes someone start

### 1. Give the player something at once, and let them pick it

The collection should not start empty. Hand the player a first item in the first minutes, ideally one they chose, and make the first pull a good one. Owning something makes it worth more to its owner than the same thing was worth before they had it, so the first item does more than fill a slot: it makes the player an owner, with something to protect and build on.

- Kahneman, Knetsch & Thaler, "Experimental Tests of the Endowment Effect and the Coase Theorem", *Journal of Political Economy*, 1990 ([pdf][endowment]): "Contrary to theoretical expectations, measures of willingness to accept greatly exceed measures of willingness to pay." … "Consumption objects (e.g., coffee mugs) are randomly given to half the subjects in an experiment." … "the median selling prices in the mug and pen markets were more than twice the median buying prices".
- Blizzard, "Upcoming Card Pack Changes", Hearthstone news, 2017 ([link][hs-packs]), guaranteeing a Legendary in a new player's first packs: "with this change we hope your pack openings start off on a celebratory note!" … the payoff is "that flash of gold heralding a Legendary card".
- Our reading: the starter choice in creature collectors (one of three, chosen before anything else happens) is the endowment effect used on purpose. The player owns their first creature before they have done anything to earn it, and the choice makes it theirs.

### 2. Show the whole set, gaps and all, and make it finite

A collection pulls when the player can see what is missing. Show the full set from the start, with the missing slots visible, so every new item visibly closes a gap and the player can point at the next one they want. The set has to be finite and reachable; a set that can never be finished stops pulling. Spread the good things across the set, so the common items are worth having too.

- Garfield, via Rosewater, "The Creation of Magic: The Gathering", 2013 ([link][mtg-creation]): the idea started from marbles, where "each player had his own collection from which he would trade and compete." Garfield, via MTG Rocks, 2022, quoting an older video ([link][garfield-price]): "I wanted to see the parts collectable in the sense of stamps". A stamp album is the model: every page shows its empty frames.
- Takenori Oota (Pokémon Red & Green programmer), *Pokédex* (Creatures, 1996), translated by Lava Cut Content ([link][tajiri-1996]): "We want people to lend Pokemon just to complete their Pokedex as well." The Pokédex is the set made visible, and completing it is a reason to meet other players.
- Rosewater, "Rare Well Done", Making Magic, 2002 ([link][mtg-rare]): "This category exists because of a key belief of R&D: "good" cards should be spread among all rarities." … "we make these cards rare to maintain their specialness."
- Kivetz et al., in [`RPG.md`](RPG.md#there-is-always-a-next-goal-and-it-is-close): players speed up as a goal gets close. A visible set with few gaps left is that goal.

### 3. Collecting is for showing: build the shelf and the visit

People collect to show others. The collection needs a place to be displayed (a museum, a room, a binder, a profile) and a way for others to see it. A collection only the owner ever sees loses half its pull.

- Eguchi (Animal Crossing), Nintendo UK interview, 2016 ([link][ac-uk]): "Or you collect a lot of items, then you show it to people and share your impressions." Nogami, same interview: "just showing them to friends, like "I caught an interesting insect"". And on giving each family member their own save: it "did help further promote communication amongst the family".
- Nogami, Iwata Asks: Animal Crossing: Let's Go to the City ([link][iwata-accf]): "Visiting other people's towns is at the very heart of this series."
- Belk, "Extended Self in a Digital World", *Journal of Consumer Research*, 2013, via JSTOR Daily ([link][belk-jstor]): the motives for acquiring digital goods "are similar to those for acquiring material consumer goods: gaining status and prestige as seen by other players".

## What keeps them collecting: the collection becomes theirs

### 4. Every item does something, looks like something, or says something about its owner

A digital item is valued for three kinds of reason: what it does in the game (functional), how it looks and sounds and fits the world (hedonic), and what owning it says to others (social). An item with none of these is a checkbox. The game gives an item its value by making a place where it matters; nothing outside the game does it.

- Lehdonvirta, "Virtual item sales as a revenue model", *Electronic Commerce Research*, 2009, as summarized by Engadget ([link][lehdonvirta-eng]): "Functional attributes, such as speed, hitpoints, teleportation." … "Hedonic attributes, or how the virtual gear looks or sounds," … "its provenance or its connection to the background fiction of the setting, and of course customizability." … "Social attributes, particularly the prestige accorded with ownership of a rare item."
- Lehdonvirta, *Virtual Consumption*, doctoral dissertation, 2009 ([pdf][lehdonvirta-diss]): "the fundamental drivers of virtual consumption are rather found in individuals’ social and hedonic motivations." … "virtual goods function as markers of status, elements of identity and means towards ends".
- Hamari & Lehdonvirta, "Game design as marketing: How game mechanics create demand for virtual goods", *International Journal of Business Science and Applied Management*, 2010 ([link][hamari]): "as the value for the goods has to be first created through designing the context for the goods." The paper is about selling goods, but the point holds for any collection: the value comes from the context the designer builds.
- Jay of Bytten Studio (Cassette Beasts), Pocket Tactics interview ([link][cassette]): "we wanted them to look like a true 'set' together". The hedonic side of a collection is a set that belongs together.

### 5. An item remembers where it came from

Two copies of the same item are not the same to their owners if one has a story: where it was caught, who traded it, when it was won. Record that history and show it. It is what makes a copyable thing particular, and it is the part of a digital possession that people feel as part of themselves; losing it feels like losing part of who they are in the game.

- Lehdonvirta, via Engadget (above): hedonic value includes "its provenance or its connection to the background fiction of the setting".
- Satoshi Tajiri, *Pokédex* (1996), translated by Lava Cut Content ([link][tajiri-1996]): "we want people to feel like they're living creatures moving from one Game Boy to another." Tajiri, TIME interview, 1999 ([link][tajiri-time]): "I thought of actual living organisms moving back and forth across the cable." A traded creature keeps who caught it, and that is why it is more than a copy.
- Belk, via JSTOR Daily ([link][belk-jstor]): a Second Life resident, after a glitch emptied and then restored their inventory: "my inventory is back but I'm a shadow of my former self." Belk calls backing up digital things a "curatorial ritual".
- Our reading: in a Ritmo game, provenance is data. Where an item came from belongs in the save next to the item, under ids that never change (spirit-call already treats shipped content ids as permanent, because saves refer to them).

### 6. Effort is the price, and finishing is what makes it count

A digital item can be copied for free, so what makes it scarce is what it took to get: time, skill, a journey, a person met. Effort makes people value what they made, but only when the effort finishes in something. A collection that asks for work and never completes a set, or a crafted item that is later taken away, loses the effect.

- Lehdonvirta, *Virtual Consumption* ([pdf][lehdonvirta-diss]), on EverQuest: "these goods are scarce: their production is programmed to require a limited resource, players’ time."
- Norton, Mochon & Ariely, "The IKEA Effect: When Labor Leads to Love", *Journal of Consumer Psychology*, 2012 ([pdf][ikea]): "We show that labor leads to love only when labor results in successful completion of tasks;" … "when participants built and then destroyed their creations, or failed to complete them, the IKEA effect dissipated."
- Our reading: sets should come in sizes that finish (a page, a region, a family), each with a moment that marks it done, not one long list the player only finishes after hundreds of hours.

### 7. A duplicate is never a dead pull

When a reward can be something the player already has, a duplicate feels like nothing, or like a loss. Either never give one, or turn it into progress (a currency to craft what is missing, an upgrade, a gift for a friend). Never make the player destroy part of their collection to get what they want.

- Blizzard, Hearthstone news ([link][hs-packs]), on removing duplicate Legendaries from packs: "Soon, you'll be able to craft a Legendary without the worry of opening it in your next few packs!" … "these changes should make the pack opening experience more exciting than ever".
- Dillon Buckner (Legends of Runeterra), Inven Global interview ([link][lor]): "We want players to be able to build their collections in LoR, not feel like they have to destroy parts of it".
- Oota (above): duplicates in Pokémon are what the player lends and trades to complete someone else's set.

## What makes a digital thing valuable

### 8. Scarcity is real, and it has a reason

Things in short supply are valued more; most of all when they become scarce, and when they are scarce because others want them, not by accident. In a game, the designer controls supply completely, so scarcity is a promise: once the player believes a rare thing is rare, flooding the supply drops its value at once and breaks the promise. Give scarcity a reason the player can see (a hard place, a strong enemy, another player's version of the world) rather than an arbitrary drop rate.

- Worchel, Lee & Adewole, "Effects of Supply and Demand on Ratings of Object Value", *Journal of Personality and Social Psychology*, 1975 ([pdf][worchel]): "cookies in scarce supply were rated as more desirable than cookies in abundant supply;" … "cookies were rated as more valuable when their supply changed from abundant to scarce than when they were constantly scarce;" … "cookies scarce because of high demand were rated higher than cookies that were scarce because of an accident."
- Robin Walker (Team Fortress 2), "Valve on the future of Team Fortress 2, part two", PC Gamer ([link][tf2-walker]), on players' rare employee badges: "part of the fact they care about them is because they're rare."
- Eyjólfur Guðmundsson (EVE Online's economist), Massively interview, 2009, via Engadget ([link][eve-massively]): "if we increase, through game mechanics, availability of a certain item, we see it instantaneously drop in prices."
- Ben Brode (Marvel Snap), via GINX TV quoting Polygon ([link][snap-trading]): "We basically gave everyone a photocopier to make their own copies as many times as they wanted". If players can make supply, nothing they make is scarce.
- The limit, from the anonymous "How video games abuse the fear of missing out", Game Developer, 2021 ([link][fomo]): "Limited-time content manipulates consumers into putting more value on something" … "Keeping content held hostage is not how you can build a long-term sustainable game". This is a featured blog post, not research; it is here because it names the cost of the most common way to make scarcity.

### 9. Status needs an audience

Rare items are worth most when others can see them. The social value of an item (principle 4) only exists where other players are, so a status item needs a place to be seen: on the character, in a visited room, on a profile. Players also want to show what group they belong to, not only how rare their things are.

- Walker, PC Gamer ([link][tf2-walker]): "Customers being able to make themselves stand out in any way has value. Status has value to people." … "players really value is the ability to display their status and display their affiliation."
- Belk, via JSTOR Daily ([link][belk-jstor]): Belk first expected that "possessions in Second Life may only be seen as part of extended self by other residents of Second Life", and found that people acquire digital goods for "gaining status and prestige as seen by other players".
- Guðmundsson, GDC 2008, in Adam Martin's notes ([link][eve-gdc]): "Value in a virtual world is real because the players are real."

## Trading

### 10. Trading starts from difference

A trade happens when each player has something the other wants and cannot easily get. So trading has to be designed in from the start: give players different things (different versions, starting places, regions, seasons), so that each one holds what someone else needs, and make sure both sides of a trade give up something of value. The trade itself is a moment of contact between two people, and that is half its point.

- Tajiri, *Pokédex* (1996), translated by Lava Cut Content ([link][tajiri-1996]): "So our original idea for Pokemon wasn't 'we want to make an RPG' — instead, it was 'we want to trade.'" … "we wanted to make sure both players would trade something of value." … "So people will want to trade to get something rare or something they want." Miyamoto "suggested we 'give people more reason to want to trade.'", which became "two different color versions with different Pokemon appearing in them, that will get people excited about trading."
- Tajiri, TIME, 1999 ([link][tajiri-time]): "The idea I had was for information to go back and forth. It wasn't about competition." … "The concept of the communication cable is really Japanese: one-on-one."
- Moro (Animal Crossing: New Leaf), Iwata Asks: Animal Crossing: New Leaf ([link][iwata-acnl]): "Or you could meet up to exchange fruit." … "I'd be happy if turnips inspired players to go and check out each other's towns."
- Brode, via GINX TV ([link][snap-trading]): "Trading would be rad!" … "which breaks the 'trading' market because increasing supply is essentially free." The counter-case: where supply is free, there is no difference to trade on.

### 11. An economy needs sinks, or everything becomes worthless

Players hoard. If items and currency only flow in, supply piles up, prices collapse, and nothing is worth trading for; players then leave because there is nothing left to want. Every faucet needs a sink that takes things out for good (use, upgrades, gifts that are consumed, items that wear out), and the money supply should grow only with what players do with it. Watch the numbers after launch: no economy is right the first time.

- Zack Simpson, "The In-game Economics of Ultima Online", 1999 ([link][uo-econ]): "players tend to hoard items en masse." … "A favorite anecdote among the designers is of a character who had over ten thousand identical shirts in his house!" … "Players lose interest in the game because there is nothing left to acquire." … "Incentives to overproduce result in oversupply and devalued prices" … "The hyperinflation destroyed the gold economy".
- Guðmundsson, GDC 2008, in Martin's notes ([link][eve-gdc]): "Need sinks so you have something you can tweak to change this" … "The amount of money in your game-world MUST grow in-line with economic activity." … "Constantly monitor the system – not enough just to make it well at first, must keep adapting and tweaking it".
- Cook's value chains in [`RPG.md`](RPG.md#one-thing-the-player-wants-and-every-system-feeds-it) make the same point from the design side: a resource with no sink piles up until it means nothing.

### 12. Barter is clumsy: give trades a medium, or keep them one-on-one

Swapping item for item needs two players who each want what the other has, at the same time. Large trading communities invent a currency to get around this, even when the game offers none, and fall back to barter when the currency fails. A small game has two honest choices: give trades a medium (a currency, a trade board, a mailbox that holds offers) or keep trades personal, between two friends who already know what each other needs.

- Yanis Varoufakis (Valve's economist in residence), "Arbitrage and Equilibrium in the Team Fortress 2 Economy", Valve economics blog, 2012, via gwern.net's copy ([link][tf2-varoufakis]): TF2's economy is "one in which barter still prevails even though the volume of trading is skyrocketing." … "Barter economies are cumbersome precisely because they require this double coincidence of wants." … "one of those assets soon emerged as a *numéraire* – a basic form of money that is."
- Simpson ([link][uo-econ]): "Players resort to barter as the currency hyper-inflates or disappears."
- Tajiri (above): the cable is "one-on-one", and "the players pick who they play against."
- Our reading: a small 2D game has no server-run market to tune, so trades between friends (a link, a code, a visit) are the version a small team can build and keep fair.

### 13. Keep trading inside the game, never for money

When game items can be sold for real money, prices follow collectors and speculators, not players, and the game prices out the people it was made for. Players have so far shown little interest in owning game items as assets: the resale pitch has mostly failed.

- Garfield, via MTG Rocks ([link][garfield-price]): "My intuition is that having a $20 card is about right." … "Now, having $20 cards is probably going to push some people out of the market" … "But, for players, I don't really see that as being a good thing. I think there's a limit."
- Nicolas Pouard (Ubisoft), via Engadget, 2022 ([link][quartz]), after Ubisoft's in-game NFTs sold poorly: "I think gamers don't get what a digital secondary market can bring to them." … "The end game is about giving players the opportunity to resell their items". Engadget reports that sales "have reportedly been very sluggish."
- Walker, PC Gamer ([link][tf2-walker]): "the incremental money we can make off lots of things is worth way less than a bunch of people".

## The line not to cross

### 14. Never sell the pull

The random pull (a pack, a capsule, an egg) is a real pleasure, and players miss it when it is gone. Selling it is a different thing: random rewards bought with money share their features with gambling, and spending on them is linked to problem gambling. Keep the pull, earned in play; sell nothing random. More broadly, a pattern that works by making the player feel worse (a timer that punishes absence, an item that disappears unless bought now) does not belong in the game.

- Zendle & Cairns, "Video game loot boxes are linked to problem gambling: Results of a large-scale survey", *PLOS ONE*, 2018 ([pdf][zendle]): "Loot boxes are items in video games that can be paid for with real-world money and contain randomised contents." … "This link was stronger than a link between problem gambling and buying other in-game items" … "these results suggest that there may be good reason to regulate loot boxes in games." The University of York's summary ([link][york]): "problem gambling is more closely linked to loot box spending than to well-known risk factors".
- Buckner, Inven Global ([link][lor]): "One thing we did decide early on is that paid random packs were the root of many issues we had with existing card games." Testers then "missed the satisfaction of building their collection, or the thrill of pulling an exciting card." The answer was "our weekly Vault, which is basically our way of offering the thrill of pack pulls without making players pay for it."
- Garfield, via MTG Rocks ([link][garfield-price]): "It's exciting to bust packs open because there are these valuable treasures in them".
- Zagal, Björk & Lewis, "Dark Patterns in the Design of Games", FDG 2013, via Chen, Wang & Xiao, DiGRA 2026 ([pdf][dark-patterns]): dark patterns are "patterns used intentionally by a game creator to cause negative experiences for players". Chen et al. code "Play by Appointment/Wait to Play" and "Pay to Skip/Progress" among them.

## For a small 2D team

Our reading of the sources together. A small team cannot run a market economy or a live service, and does not need to: the strongest collecting games here (Pokémon's first versions, Animal Crossing) are built on a finite set, items that differ between players, and one-on-one exchange between friends.

- **A set of dozens, not hundreds.** Each item needs art, a use, and a reason to be wanted (principle 4); a small set where every item is good beats a large one padded with filler. Pages that finish (principle 6) give the long set its milestones.
- **Difference before trading.** Decide first what makes one player's game differ from another's (a starting choice, a region, a seed), then let trading close the gaps. Without difference, leave trading out (Brode).
- **Provenance is cheap.** Recording who, where, and when costs a few fields in the save and makes every item particular.
- **Sinks from day one.** Every currency and every duplicate has somewhere to go.
- **Nothing random is sold.** If the game is paid once, the question does not come up. If it is free, sell what the player can see before buying.

## What to prototype first

Our reading, for a game made with the `ritmo-prototype` skill: the smallest collecting game that can be fun is a visible set with gaps, a way to fill one, and a moment that shows the new item off. If filling a gap is not satisfying with placeholder shapes, more items will not fix it. The question for the first round is what the player will do: "after getting their first item, does the player open the collection and go after a specific missing one?" Trading comes after, and only once two players' collections differ; its first question is "do two players who meet want something the other has?"

[endowment]: https://web.mit.edu/curhan/www/docs/Articles/15341_Readings/Behavioral_Decision_Theory/Kahneman_et_al_1990_Experimental_tests.pdf
[hs-packs]: https://hearthstone.blizzard.com/en-us/news/20852959
[mtg-creation]: https://magic.wizards.com/en/articles/archive/making-magic/creation-magic-gathering-2013-03-12
[garfield-price]: https://mtgrocks.com/according-to-mtg-creator-cards-werent-supposed-to-exceed-50/
[tajiri-1996]: https://lavacutcontent.com/satoshi-tajiri-pokedex-interview/
[tajiri-time]: https://us.cnn.com/ASIANOW/time/magazine/99/1122/pokemon6.fullinterview1.html
[mtg-rare]: https://magic.wizards.com/en/articles/archive/making-magic/rare-well-done-2002-02-25-0
[ac-uk]: https://www.nintendo.com/en-gb/News/2016/November/Learn-more-about-the-development-of-the-Animal-Crossing-series-in-our-interview--1159916.html
[iwata-accf]: https://iwataasks.nintendo.com/interviews/wii/accf/0/3
[iwata-acnl]: https://iwataasks.nintendo.com/interviews/3ds/animalcrossing-newleaf/0/3
[belk-jstor]: https://daily.jstor.org/how-much-would-you-pay-for-a-nonexistent-dress
[lehdonvirta-eng]: https://www.engadget.com/2009-01-09-why-do-people-buy-virtual-goods-in-mmos.html
[lehdonvirta-diss]: https://utupub.fi/bitstream/handle/10024/98536/Ae11_2009lehdonvirta.pdf
[hamari]: https://readkong.com/page/game-design-as-marketing-how-game-mechanics-create-7636523
[cassette]: https://www.pockettactics.com/cassette-beasts/interview
[ikea]: https://dash.harvard.edu/bitstream/handle/1/12136084/norton%20mochon%20ariely%20third%20round[1].pdf
[lor]: https://www.invenglobal.com/articles/10365/legends-of-runeterra-developer-dillon-buckner-talks-about-the-games-early-development-designing-its-unique-economy-and-riots-approach-to-card-balance
[worchel]: https://uni-muenster.de/imperia/md/content/psyifp/aeechterhoff/vorlesungkommunikation/worchelleeeta_suppdemanobjval_jpsp1975.pdf
[tf2-walker]: https://www.pcgamer.com/uk/valve-on-the-future-of-team-fortress-2-part-two/
[eve-massively]: https://www.engadget.com/2009-02-19-massively-interviews-eve-online-lead-economist-dr-eyjog.html
[eve-gdc]: https://t-machine.org/index.php/2008/02/24/gdc08-virtual-greenspans-running-an-mmog-economy
[snap-trading]: https://www.ginx.tv/en/trading
[fomo]: https://www.gamedeveloper.com/business/how-video-games-abuse-the-fear-of-missing-out
[uo-econ]: https://gwern.net/doc/economics/1999-04-07-simpson-theingameconomicsofultimaonline.html
[tf2-varoufakis]: https://www.gwern.net/docs/economics/2012-varoufakis-teamfortress2arbitrage.html
[quartz]: https://www.engadget.com/ubisoft-nft-executive-response-155250977.html
[zendle]: https://eprints.whiterose.ac.uk/139116/1/journal.pone.0206767.pdf
[york]: https://www.york.ac.uk/news-and-events/news/2018/research/researchers-find-link-problem-gambling-loot-boxes
[dark-patterns]: https://dl.digra.org/index.php/dl/article/download/3101/3085/3144
