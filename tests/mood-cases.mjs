// Casos SINTÉTICOS del Paso 0 de MEM-011 (heurística sin modelo). Cada caso: los recuerdos activados en un mensaje del personaje (con
// el estilo de hechos concretos con nombres que produce la extracción de MEM-003) y la etiqueta que una persona razonable esperaría
// (`null` = "sin una emoción clara: no mostrar nada"). Escritos ANTES de afinar la tabla; sirven de prueba de regresión y de medida de acierto.
const E = (content, extra = {}) => ({ id: content.slice(0, 8), keys: [], content, always: false, ...extra });
const C = (name, expected, ...entries) => ({ name, expected, loreUsed: entries.map((e) => (typeof e === 'string' ? E(e) : e)) });

export const MOOD_CASES = [
  C('cariño (inglés)', 'sintiendo cariño', 'Sam gave Mia a long hug when she was upset.', 'Sam says he loves the way Mia laughs.', 'Sam and Mia held hands during the walk home.'),
  C('nostalgia (inglés)', 'sintiendo nostalgia', "Sam misses his grandmother's kitchen in Valencia.", 'Sam grew up in a small fishing town.', 'Sam remembers the old radio his father used to fix.'),
  C('ilusión (inglés)', 'sintiendo ilusión', 'Sam is planning a trip to Japan next spring.', "Sam can't wait for his sister's wedding in June.", 'Sam dreams of opening his own bakery.'),
  C('gratitud (inglés)', 'sintiendo gratitud', 'Sam thanked Mia for staying up with him during exams.', 'Mia helped Sam rehearse for his interview.', 'Sam is grateful for the scarf Mia gave him.'),
  C('preocupación (inglés)', 'sintiendo preocupación', 'Sam is anxious about his surgery next week.', "Sam's mother is in the hospital.", 'Sam has trouble sleeping before exams.'),
  C('tristeza (inglés)', 'sintiendo tristeza', "Sam's dog died last winter.", 'Sam cried at the funeral.', 'Sam feels lonely on Sundays.'),
  C('alegría (inglés)', 'sintiendo alegría', 'Sam and Mia played cards until midnight and laughed a lot.', 'Sam likes to tease Mia about her cooking.', 'Mia told a silly joke about penguins.'),
  C('orgullo (inglés)', 'sintiendo orgullo', 'Sam graduated with honors last June.', 'Sam is proud of the bakery he built.', 'Sam won a regional baking award.'),
  C('calma (inglés)', 'sintiendo calma', 'Sam likes quiet evenings with tea.', 'Mia enjoys the rain on the window.', 'Sam finds the garden peaceful.'),
  C('asombro (inglés)', 'sintiendo asombro', 'Sam showed Mia the stars from the roof.', 'Mia was amazed by the northern lights photos.', 'Mia wonders how big the universe is.'),
  C('hechos neutros: nada', null, 'Sam works at a bakery on Elm Street.', 'Sam is allergic to peanuts.', 'Sam lives on the third floor.'),
  C('empate (abrazo, llanto, extrañar): ambiguo, nada', null, 'Sam gave Mia a hug.', 'Sam cried when he said goodbye.', 'Sam misses her already.'),
  C('una sola señal débil: nada', null, 'Sam works at a bakery.', 'Sam has a sister named Ana.', 'Sam loves jazz.'),
  C('cariño (español)', 'sintiendo cariño', 'Sam le dio un abrazo a Mia cuando estaba triste.', 'Sam le dijo a Mia que la quiere mucho.', 'Sam besó a Mia en la frente.'),
  C('nostalgia (español)', 'sintiendo nostalgia', 'Sam extraña la casa de su abuela.', 'Sam recuerda su infancia en el pueblo.', 'Sam creció cerca del mar.'),
  C('preocupación (español)', 'sintiendo preocupación', 'Sam está preocupado por su examen final.', 'La madre de Sam está enferma.', 'Sam tiene miedo de las alturas.'),
  C('los "siempre presentes" no cuentan: solo 2 por tema', null, 'Sam hugged Mia and told her he loves her.', 'Sam kissed Mia goodnight.', E('Sam adores Mia.', { always: true }), E('Sam cherishes Mia.', { always: true })),
  C('solo 2 recuerdos: no procede', null, 'Sam hugged Mia and told her he loves her.', 'Sam kissed Mia goodnight.'),
  C('una emoción en un solo recuerdo: nada', null, 'Sam works nights as a nurse.', "Sam's favorite color is green.", 'Sam was sad about missing the concert.'),
  C('gratitud con un regalo de cumpleaños', 'sintiendo gratitud', 'Mia thanked Sam for the flowers.', 'Sam gave Mia a gift for her birthday.', 'Sam loves buying Mia small presents.'),
  C('alegría (fiesta, baile, canto)', 'sintiendo alegría', 'Sam has a party planned for Friday.', 'Sam loves to dance.', 'Mia enjoys singing in the shower.'),
  C('no confundir "huge" con "hug" ni "won\'t" con "won"', null, 'Sam has a huge collection of vinyl records.', "Sam won't eat spicy food.", "Sam's shelf is full of comics."),
  C('hechos neutros con palabras sueltas (lluvia, té): nada', null, 'It was raining when Sam and Mia first met.', 'Sam works at the tea shop downtown.', "Sam's old car is a blue sedan."),
  C('nostalgia domina sobre un abrazo', 'sintiendo nostalgia', 'Sam misses his brother.', 'Sam remembers summers at the lake.', 'Sam hugged his brother goodbye.'),
];

// Segundo juego, escrito con OTRO vocabulario (hechos que una persona lee con una emoción clara pero sin las palabras de la tabla). `expected` = la
// emoción que vería una persona; `spoken` = lo que la heurística responde HOY (`null` = se calla). Mide la cobertura real: la tabla acierta cuando
// habla y se calla cuando no reconoce nada; nunca debe decir una emoción distinta de `expected`.
export const MOOD_CASES_OTHER_PHRASING = [
  { ...C('cariño sin palabras de la tabla', 'sintiendo cariño', 'Mia likes it when Sam reads to her before bed.', 'Sam brought Mia soup when she had the flu.', 'Sam always saves the last cookie for Mia.'), spoken: null },
  { ...C('tristeza con un solo recuerdo reconocible', 'sintiendo tristeza', "Sam's father passed away when he was twelve.", "Sam keeps his father's watch in a drawer.", 'Sam visits the grave every spring.'), spoken: null },
  { ...C('preocupación con un solo recuerdo reconocible', 'sintiendo preocupación', "Sam is nervous about meeting Mia's parents.", "Sam can't sleep before big presentations.", "Sam bites his nails when he's under pressure."), spoken: null },
  { ...C('alegría', 'sintiendo alegría', 'Mia and Sam stayed up all night talking about their favorite books.', "Sam finds Mia's laugh contagious.", 'Mia teased Sam about his terrible dance moves.'), spoken: 'sintiendo alegría' },
  { ...C('orgullo sin palabras de la tabla', 'sintiendo orgullo', 'Sam got his first job offer last week.', "Sam's boss praised his work.", 'Sam finished his thesis ahead of schedule.'), spoken: null },
  { ...C('nostalgia', 'sintiendo nostalgia', 'Sam grew up near the sea.', "Sam's mother used to sing to him.", 'Sam kept his childhood teddy bear.'), spoken: 'sintiendo nostalgia' },
  { ...C('asombro sin palabras de la tabla', 'sintiendo asombro', 'Sam has never seen snow.', 'Mia wants to show Sam the mountains.', 'Sam is curious about everything Mia knows.'), spoken: null },
  { ...C('disculpa/culpa: no hay categoría', null, 'Sam apologized for missing Mia\'s recital.', 'Sam felt guilty about forgetting the date.', 'Mia forgave Sam.'), spoken: null },
  { ...C('ilusión (español)', 'sintiendo ilusión', 'Sam sueña con abrir su propia panadería.', 'Sam planea un viaje a Japón con Mia.', 'Mia le preparó una sorpresa de cumpleaños.'), spoken: 'sintiendo ilusión' },
  { ...C('tristeza (español)', 'sintiendo tristeza', 'La perra de Sam murió el invierno pasado.', 'Sam lloró en el funeral de su tío.', 'Sam se siente muy triste los domingos.'), spoken: 'sintiendo tristeza' },
  { ...C('cariño (inglés, otro fraseo)', 'sintiendo cariño', 'Sam kissed Mia on the forehead.', 'Mia cuddles up to Sam on the couch.', 'Sam calls Mia sweetheart.'), spoken: 'sintiendo cariño' },
  { ...C('gratitud (inglés, otro fraseo)', 'sintiendo gratitud', 'Sam thanks Mia every morning for the coffee.', 'Mia appreciates that Sam listens to her.', 'Sam owes his degree to Mia’s support.'), spoken: 'sintiendo gratitud' },
];
