# Anatomía de un kit de marca, y qué se llena solo

Las nueve secciones de abajo son las de un manual de marca profesional. Al lado
de cada una dice **quién la llena**, y eso es lo único que hay que mirar:

- **escaneo** — sale del sitio, lo escribe `scan_site.py`. No lo toques a mano.
- **hueco** — es criterio, no dato. Nadie lo puede deducir de un CSS: se lo
  preguntás al cliente. Aparece en `gaps` de `brand.json`.
- **derivado** — se calcula a partir de lo escaneado (contraste, escalas).

| # | Sección | Quién |
|---|---|---|
| 1 | Identidad — nombre, bajada, sitio | escaneo (bajada suele quedar **hueco**) |
| 2 | Logo — principal, variantes, favicon | escaneo (archivos) + **hueco** (cuál es la principal) |
| 3 | Uso del logo — aire, tamaño mínimo, usos indebidos | **hueco** |
| 4 | Color — roles, hex, RGB | escaneo + derivado |
| 5 | Contraste y accesibilidad | derivado |
| 6 | Tipografía — títulos, cuerpo, pesos, fallbacks | escaneo |
| 7 | Imágenes e iconos — estilo, qué sí y qué no | **hueco** |
| 8 | Voz y tono — cómo habla, qué palabras no usa | **hueco** |
| 9 | Aplicaciones — formatos de redes, firma de mail | derivado + **hueco** |

## Lo que el escaneo NO puede saber, y hay que preguntar

Son seis, y se preguntan **todas juntas en una sola tanda**. Preguntar de a una
es lo que hace que el cliente abandone a la tercera.

1. **Cuál es el logo principal** de los archivos que encontramos, y si hay una
   versión para fondo oscuro.
2. **Aire y tamaño mínimo** del logo, si es que alguien lo definió alguna vez.
3. **Qué no se hace nunca** con la marca (deformarla, cambiarle el color,
   ponerla sobre una foto cargada).
4. **Estilo de imagen**: fotos reales del negocio, ilustración, producto sobre
   fondo plano. Y qué NO va.
5. **Voz**: cómo le habla a su cliente —de vos o de usted—, qué tono, y **tres
   palabras que la marca no usa nunca**. Esto es lo que después consume
   `social-content`; sin esto escribe como IA genérica.
6. **Qué queda afuera**: si hay algo del sitio que ya no representa a la marca
   (un color viejo, un logo anterior).

## Reglas al llenar

- **Un hueco sin contestar se queda como hueco.** No se rellena con un valor
  razonable: un kit que afirma algo que nadie decidió es peor que uno incompleto,
  porque después alguien lo usa creyendo que está acordado.
- **Los roles importan más que la lista.** "Primario, acento, texto, fondo" es
  usable; veinte hex ordenados por frecuencia no le sirven a nadie.
- **Menos es más**: 2 tipografías y 5 colores. Si el escaneo trae 14 colores, es
  porque el sitio tiene ruido (sombras, bordes, estados), no porque la marca
  tenga 14.

## Contraste (sección 5)

Se mide con WCAG 2.1. Los umbrales:

| Uso | Mínimo AA | AAA |
|---|---|---|
| Texto normal | 4,5:1 | 7:1 |
| Texto grande (≥18,66px negrita o ≥24px) | 3:1 | 4,5:1 |
| Bordes de controles, íconos | 3:1 | — |

Un par que no llega a 4,5:1 **no se reporta como detalle estético**: es texto que
un cliente de la clienta no va a poder leer. Se dice con el número medido.
