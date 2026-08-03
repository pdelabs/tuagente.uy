# Spec — Actividad + Archivos + Uso (owner: subagente F · dirs: app/app/{actividad,archivos,uso}/)

Tres pantallas chicas contra el adapter (contrato abajo; A implementa en paralelo).

1. Actividad: GET {adapter}/portal/activity → {events:[{ts,kind,label,status}]}
   (corridas de jobs con resultado, entregas). Timeline vertical simple,
   chips de estado, agrupado por día.
2. Archivos: GET {adapter}/portal/files → {files:[{path,size,mtime}]} y
   GET {adapter}/portal/files/{path} → text/plain. Lista + viewer de texto
   monoespaciado (los .md del workspace: reportes, dossiers). Solo lectura.
3. Uso: GET {adapter}/portal/usage → {sessions,input_tokens,output_tokens,
   total_tokens,period}. Tiles grandes tonales con números tabulares.
- DoD: las tres pantallas contra La Mano real cuando A publique; mientras,
  contra el contrato con estados de "endpoint no disponible" elegantes.
