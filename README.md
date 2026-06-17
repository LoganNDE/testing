# IFS-HPC Audit Desk

Aplicacion web para auditar empresas contra una norma tipo IFS-HPC.

## Comandos

```bash
npm install
npm test
npm run dev
```

En PowerShell, si aparece un error de politica de ejecucion con `npm.ps1`, usa `npm.cmd`:

```powershell
npm.cmd install
npm.cmd test
npm.cmd run dev
```

Despues abre la URL que muestre Vite, normalmente:

```text
http://127.0.0.1:5173
```

`npm run dev` arranca Vite y la API local de auditoria por voz. Para activar la IA:

1. Copia `.env.example` a `.env`.
2. Define `OPENAI_API_KEY`.
3. Manten `OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe` y `OPENAI_AUDIT_MODEL=gpt-4.1-mini`, o ajustalos si necesitas otros modelos compatibles.

La clave se usa solo en el servidor local `server/api-server.mjs`; nunca se expone al navegador.

La auditoria por voz mantiene las claves fuera del frontend:

- El navegador solo llama a `/api/voice-audit` o a `VITE_API_BASE_URL/api/voice-audit`.
- `OPENAI_API_KEY` solo se lee en el proceso Node del servidor.
- Ninguna variable con prefijo `VITE_` debe contener secretos, porque Vite las incluye en el bundle del navegador.
- OpenAI se usa en el servidor para transcribir audio y estructurar los campos de auditoria.
- El servidor envia a la IA un indice minimo de puntos (`id`, `code`, `mandatory`, `ko`), no el texto completo de la norma.
- `MAX_VOICE_AUDIT_BYTES` limita el tamano de audio/transcripcion aceptado; el ejemplo usa 150 MB, pensado para unas 2 horas de audio comprimido.
- Para mejores resultados, dicta siempre el codigo y los campos: `Punto 2.1.1.3 conforme. Comentario... Datos adicionales...`.

Para generar una version de produccion:

```bash
npm run build
```

En produccion la ruta `/api` no se proxyea automaticamente como en Vite dev. Si despliegas el frontend y la API en dominios distintos, define antes de compilar:

```bash
VITE_API_BASE_URL=https://tu-api.example.com
```

Y en el servidor de API ajusta:

```bash
CORS_ORIGIN=https://tu-frontend.example.com
API_HOST=0.0.0.0
```

Para regenerar el JSON de la norma desde el PDF original:

```bash
npm run extract:ifs
```

## Uso

1. Al iniciar, completa empresa, centro, auditor y fecha.
2. Selecciona los puntos y subpuntos que entran en el alcance de la auditoria.
3. Puedes seleccionar todos, deseleccionar todos o buscar puntos concretos.
4. Pulsa `Comenzar auditoria`.
5. Elige auditoria manual o auditoria automatica por voz.
6. En modo voz, graba o pega una transcripcion y pulsa `Procesar y rellenar auditoria`.
7. En modo manual, usa `Anterior` y `Siguiente` para avanzar punto por punto.
8. Marca cada requisito como `Conforme`, `No conforme` o `No aplica`.
9. Anade comentarios y datos adicionales.
10. Usa la navegacion inferior para cambiar entre `Auditar`, `Datos`, `Estado` y `Excel`.

## Formato del JSON IFS-HPC

El JSON generado separa la jerarquia de la norma:

- `titulo` solo se rellena cuando el PDF tiene un encabezado real.
- `texto` contiene siempre el requisito auditable completo.
- Si un punto no tiene titulo real, `titulo` queda como `null` y la app usa el numero del punto como referencia visual.

## Formato del JSON flexible

El importador acepta estructuras flexibles. Puede leer arrays planos:

```json
[
  {
    "code": "1.1",
    "title": "Sistema de gestion",
    "requirement": "La empresa debe mantener un sistema documentado.",
    "mandatory": true
  }
]
```

Tambien acepta estructuras anidadas con claves como `points`, `items`, `requirements`, `clauses`, `checklist`, `children` o `subpoints`.

## Funciones incluidas

- Indice navegable y buscador de puntos.
- Filtros por estado.
- Puntos obligatorios y omitibles.
- Guardado automatico en el navegador.
- Estadisticas de progreso y cumplimiento.
- Exportacion Excel con comentarios, datos adicionales y estado de cada punto.
- Campos especificos de IFS-HPC: KO, pagina y puntos que requieren informacion adicional en informe.
- Interfaz responsive optimizada para auditoria desde movil.
- Flujo guiado por pasos: datos iniciales, seleccion de alcance y auditoria.
- Navegacion inferior tipo app movil.
- Tests unitarios para parser de JSON y calculo de resultados.
