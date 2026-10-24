"""Génère des vecteurs de référence avec py-fsrs (implémentation officielle FSRS-6, version 6.3.2).
Usage : python gen_reference.py > reference.json   (nécessite `pip install fsrs==6.3.2`)
Sans étapes d'apprentissage ni flou : on compare stabilité, difficulté et intervalle après chaque révision."""
import json, random
from datetime import datetime, timedelta, timezone
from fsrs import Scheduler, Card, Rating

random.seed(42)
out = []
for retention in (0.9, 0.85, 0.95):
    sch = Scheduler(desired_retention=retention, learning_steps=(), relearning_steps=(), enable_fuzzing=False, maximum_interval=36500)
    for case in range(40):
        card = Card()
        t = datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc)
        steps = []
        for i in range(random.randint(3, 14)):
            rating = random.choices([1, 2, 3, 4], weights=[15, 15, 55, 15])[0]
            card, _ = sch.review_card(card, Rating(rating), review_datetime=t)
            ivl = (card.due - t).days
            steps.append({"t": t.isoformat(), "rating": rating, "s": card.stability, "d": card.difficulty, "ivl": ivl})
            # prochaine révision : à l'heure, en retard, en avance, ou le jour même (court terme)
            mode = random.random()
            if mode < 0.1:
                t = t + timedelta(hours=2)
            elif mode < 0.6:
                t = card.due
            else:
                t = t + timedelta(days=max(1, round(ivl * random.uniform(0.5, 2.5))))
        out.append({"retention": retention, "steps": steps})
print(json.dumps({"source": "py-fsrs 6.3.2", "parameters": list(sch.parameters), "cases": out}))
