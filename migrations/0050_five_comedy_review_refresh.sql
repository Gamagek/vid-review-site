-- Refresh five existing comedy reviews from the video-specific scene notes already
-- recorded for these exact source URLs. Do not touch created_at, updated_at,
-- source metadata, visibility, engagement counts, or canonical slugs.
-- The WHERE clause prevents updates if a slug has been repointed to another source.
-- All statements are idempotent and deliberately omit RETURNING; replay is safe.

UPDATE videos
SET description = 'A barber handover leads into a whipped-cream mess, improvised sunglasses and a few household-tool cutaways. The strongest moments are visual and immediate; the quick changes make this feel like a gag reel rather than one continuous story.',
    review_text = '1. 💈 The barber switch sets the pace
The opening changes who is in control of a haircut, then cuts to a phone image and a surprised close-up. The idea is readable, but the short setup leaves little room for a longer exchange or a clearer reason for the switch.

2. 🍦 The cream gag has the clearest payoff
A woman brings whipped cream toward her mouth, makes a sneeze-like movement and ends up with cream across her face. The visible result carries the joke without needing a long explanation; the movement alone does not establish that an audible sneeze occurred.

3. 🕶️ A prop takes the joke somewhere else
Clear adhesive and sunglasses appear in an improvised arrangement on a man''s forehead inside a vehicle. It is an odd image that suits the compilation''s tone, but the clip does not show the arrangement being tested or establish it as a useful DIY idea.

4. 🛠️ Household cutaways widen the subject
Drilling near a door and looking over a power strip shift the montage toward tools and home tinkering. These details are noticeably separate from the haircut and food moments, so the video plays as a sequence of short gags rather than a developing story.

5. ✂️ Quick editing does most of the work
The clip moves rapidly from a setup to a face, prop or reaction. That pace keeps it lively, although some ideas change before the viewer has time to understand what the person intended.

6. ✅ What works and what does not
The cream close-up is the most immediately understandable payoff, while the sunglasses and tool scenes add variety. The comedy is best taken as visual entertainment, not as advice for drilling, electrical work or improvised repairs.',
    seo_title = 'Whipped Cream, Barber Switch and DIY Gags | Vid.Best',
    seo_description = 'A barber handover, a whipped-cream mishap and improvised sunglasses lead into quick tool cutaways. A close look at the visual jokes and the fast editing.',
    seo_tags = '["whipped cream prank","barber takeover gag","sunglasses prop comedy","DIY visual gags","short comedy montage","face reaction humour","improvised props","visual prank review"]'
WHERE slug = 'whipped-cream-sneeze-barber-takeover-and-diy-gags'
  AND source_url = 'https://www.youtube.com/shorts/PCLXcrXkszI'
  AND published = 1;

UPDATE videos
SET description = 'A lively kitchen performance gives way to banana match-cuts, an oversized sandwich bite and an ice-cream finish. The comedy comes from comparing separate scenes, with the cut itself often doing more than a shared storyline.',
    review_text = '1. 🎤 The kitchen performance opens with a clear contrast
An energetic performer occupies the kitchen while another person is focused on cooking. Their different levels of attention provide the initial comic tension, but the clip moves on before it becomes a full musical scene.

2. 🏃 The montage keeps changing its setting
Athletic and classroom excerpts arrive as short interruptions rather than chapters in one story. Their connection is created by timing and reaction-panel edits, not by evidence that the events belong to the same incident.

3. 🍌 The banana match-cut is easy to read
Green bananas outdoors are paired with yellow bananas in a kitchen. Repeating a similar object across different settings makes the transition understandable at a glance, even without a spoken explanation.

4. 🥪 Small actions become visual comparisons
A hair-stroking comparison and a couple taking uneven sandwich bites use a similar comic device: the viewer sees one action, then another that changes its scale or outcome. The food sequence is more immediately readable because the shared meal gives the comparison a familiar baseline.

5. 🔊 Sound adds energy but not extra context
Lively vocal sounds, short dialogue and music fragments are layered with a recurring high-pitched laugh effect. That cue ties the excerpts together, although the clip does not establish a reliable performer or song credit from those brief fragments.

6. 🍦 The ending breaks the reaction pattern
An ice-cream smear is followed by a brief pigeon cutaway. The change of subject works as a final interruption, but it also underlines that the montage is collecting separate moments rather than resolving one story.

7. ✅ Overall impression
The banana comparison and uneven sandwich bites are the most legible visual ideas. The fast variety suits viewers who enjoy short comedy compilations, while some of the quicker transitions feel more surprising than fully developed.',
    seo_title = 'Banana Match-Cuts, Kitchen Singing and Food Gags | Vid.Best',
    seo_description = 'Kitchen singing, banana comparisons, sandwich bites and an ice-cream finish make a quick visual-comedy montage built around contrasts between separate scenes.',
    seo_tags = '["kitchen singer gag","banana comparison edit","oversized sandwich bite","classroom comedy clip","food prank montage","reaction panel humour","ice cream face gag","visual match cuts"]'
WHERE slug = 'kitchen-singer-banana-tricks-and-ice-cream-face-prank'
  AND source_url = 'https://www.youtube.com/shorts/I6fejmn7RJU'
  AND published = 1;

UPDATE videos
SET description = 'A carton splash and a dentist-side phone gag lead into a whipped-drink beard and a food-withdrawal joke. The best moments build a simple expectation, then change it with a clear visual reversal.',
    review_text = '1. 🥤 The carton splash gets attention quickly
The opening splash is abrupt and immediately visible. It gives the montage a strong start, although the surprise arrives faster than any detailed setup, so the moment depends mainly on the reaction.

2. 🦷 The dental scene changes the tone
A dentist-and-patient interaction involving a phone appears between the food gags. That interruption adds variety, but the brief scene does not establish a diagnosis, treatment result or practical dental advice; it is part of the edited comedy.

3. 🥛 The milkshake becomes a beard
A man leans into a whipped drink and cream spreads across the lower half of his face, making a beard-like shape. This is one of the clearest visual payoffs because the result is easy to recognise without extra explanation.

4. 🍖 Withholding the bite creates anticipation
At another table, food on a bone is offered toward a second diner, pulled away as they approach, and eaten by the person who offered it. The small pause matters: it lets the viewer anticipate the bite before the action reverses.

5. 🐦 The pigeon cutaway is a loose ending
The closing edit moves from an ice-cream eater looking upward to a pigeon. It creates one last interruption, though the clip does not show enough to establish what the person saw or what happened outside the frame.

6. 🎬 The scenes work better individually
The cream beard and withdrawn bite each have a clear setup and payoff. The dental insert and pigeon ending are less connected to the main food theme, making the short feel like a compilation rather than a single escalating prank.

7. ✅ Overall impression
The strongest jokes rely on timing and visible consequences, not on long dialogue. The food moments are easy to follow; the unrelated cutaways add variety but make the sequence less cohesive.',
    seo_title = 'Milkshake Beard, Dentist Joke and Food Teasing | Vid.Best',
    seo_description = 'A carton splash, a dentist-side phone gag and a whipped-drink beard lead into a food-withdrawal joke. This review looks at timing, visual payoff and the cutaways.',
    seo_tags = '["milkshake beard gag","dentist phone joke","carton splash prank","food teasing joke","cream face comedy","pigeon cutaway","reaction montage","short prank review"]'
WHERE slug = 'milkshake-beard-dentist-joke-and-food-teasing'
  AND source_url = 'https://www.youtube.com/shorts/5f0Nr5Aaz_U'
  AND published = 1;

UPDATE videos
SET description = 'A kitchen dance is interrupted by a carton splash, before the montage switches to an eye-drop setup, a repeated bent posture and a quick food gag. Its clearest ideas come from surprise and visual repetition.',
    review_text = '1. 💃 The kitchen performance sets a relaxed scene
A woman dances in a rustic kitchen while a man watches. The opening establishes a familiar domestic moment, which makes the sudden interruption feel more abrupt when the edit changes direction.

2. 🧃 The carton splash is a simple reversal
A woman squeezes a pink carton and liquid lands on a shirtless man''s face. The action is visually clear, but it is a quick surprise rather than a joke that develops through dialogue or a long sequence of reactions.

3. 💧 The eye-drop cut changes the expected subject
The montage shows a woman holding an eye open, then cuts to a small white dog beside a dropper. The contrast is the comic device; the edit does not establish that the same liquid was used on the animal or show a medical outcome.

4. 🧍 A repeated posture links different settings
A man freezes in a bent position outdoors, and a later sofa scene repeats a similar shape while paperwork is being signed. That visual echo is more distinctive than another sudden splash because it invites the viewer to notice the matching pose across unrelated clips.

5. 🍉 The food and money cutaways widen the collection
A woman bites fruit from a man''s hand, and a separate outdoor moment shows scattered banknotes being collected. Both arrive quickly and do not develop into a connected subplot, so they work as extra visual beats in the compilation.

6. 🔊 The edit leans on abrupt sound cues
Musical fragments, short speech, impact-like accents and recurring laughter keep the pacing emphatic. The video is easier to follow when an action is visible than when the cut changes subject before its context is clear.

7. ✅ Overall impression
The repeated posture is the most distinctive editing idea, while the carton splash is the most immediate. The eye-drop passage is presented as a gag and should not be read as guidance for using eye products or treating an animal.',
    seo_title = 'Kitchen Dance, Carton Splash and Eye-Drop Gag | Vid.Best',
    seo_description = 'A kitchen dance, a pink-carton splash, an eye-drop cutaway and a repeated bent posture bring several distinct visual jokes together in one fast montage.',
    seo_tags = '["kitchen dance comedy","carton splash gag","eye dropper scene","white dog cutaway","bent posture visual gag","fruit bite prank","scattered banknotes scene","quick cut comedy"]'
WHERE slug = 'kitchen-dance-carton-splash-and-eye-drop-joke'
  AND source_url = 'https://www.youtube.com/shorts/nSJquJ0OPVc'
  AND published = 1;

UPDATE videos
SET description = 'Two mop-and-drink mishaps establish a mess-driven theme, followed by a barber prop, an outdoor surprise and a phone-sound comparison. The repeated spills are familiar, while the later sound contrast changes the rhythm.',
    review_text = '1. 🧹 The first mop scene establishes the theme
Soda is poured onto a floor and the person mopping receives a wet-mop response. The gag is built around an ordinary cleanup task being turned into the next mess, with the visible action doing most of the work.

2. 🥤 The second spill repeats the idea with a variation
Another woman trips over a mop and spills her drink. It echoes the first scene, making the compilation feel connected, but the repeated spill pattern becomes more predictable once the viewer recognises the formula.

3. 💈 The barbershop prop brings the camera closer
A customer holds scissors unusually close to his nose during a barber scene. The close-up makes the prop immediately noticeable, though the brief insert offers little context beyond the awkward visual setup.

4. ⚾ An outdoor reveal resets the energy
The edit shifts outside for a baseball-bat reveal that startles a woman. This changes the scale from a close-up prop to a wider physical surprise, although the quick cut provides little follow-through after the reaction.

5. 📱 Phone labels set up a sound comparison
Two seated girls are given different phone labels as a conventional ringtone and greeting give way to a much louder alarm-like sound and startled movement. The contrast is a comic edit, not evidence about the real quality or behaviour of the products named in the labels.

6. 🔊 Sound effects tie the clips together
Short vocal sounds, a whoosh, impact accents and a recurring wheezing laugh connect otherwise separate scenes. The sounds emphasise the reaction, sometimes making the edit feel louder than the action needs.

7. ✅ Overall impression
The first two mop gags have a clear link but repeat the same basic reversal. The barber close-up and phone-sound comparison add variation, with the closing sound contrast providing a more specific change of pace than another spill.',
    seo_title = 'Soda Mop Prank, Drink Spills and Barber Surprise | Vid.Best',
    seo_description = 'Mop-and-drink mishaps lead into a barber prop, an outdoor reveal and a phone-sound comparison. A closer look at repeated setups, reaction timing and the edit.',
    seo_tags = '["soda spill prank","mop retaliation gag","barber scissors joke","outdoor reveal prank","phone ringtone comparison","sound effect comedy","floor cleaning mishap","reaction montage"]'
WHERE slug = 'soda-mop-prank-drink-spill-and-barber-surprise'
  AND source_url = 'https://www.youtube.com/shorts/7P7ZTnnEEc4'
  AND published = 1;
