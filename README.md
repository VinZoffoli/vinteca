<p><img src="build/brand/viperteca-logo.svg" alt="ViperTeca" width="300"></p>

# ViperTeca

Tu biblioteca de juegos de Steam, Epic y otras tiendas en un solo sitio. App de escritorio para Windows que reúne en una sola rejilla todos tus juegos de Steam y Epic Games (y los instalados de Riot, Rockstar, GOG, EA y Ubisoft), con sus carátulas, filtros, avisos de actualización y las ofertas de tu lista de deseados de Steam.

Está hecha con **Electron** y JavaScript sin frameworks: no hace falta instalar Rust ni herramientas de compilación, guarda la clave de Steam cifrada con tu usuario de Windows (DPAPI) y puede abrir las ventanas de inicio de sesión de Steam. Usa unos 180 MB de RAM mientras está abierta (un poco más si activas el panel flotante del modo enfoque) y **se cierra del todo al cerrar la ventana** (no se queda en la bandeja ni en segundo plano).

Código: <https://github.com/VinZoffoli/vinteca>

## Arrancar

```bash
npm install
npm start
```

Al abrirse muestra al momento lo que leyó la última vez y vuelve a leer las bibliotecas. Sin configurar nada ya verás los juegos **instalados** de Steam y la biblioteca de Epic que guarda el launcher en su caché.

## 1. Steam: clave de la API y SteamID64

1. **Clave de la API web:** entra en <https://steamcommunity.com/dev/apikey> con tu cuenta, pon cualquier dominio (por ejemplo `localhost`), acepta las condiciones y copia la clave (32 caracteres).
2. **SteamID64:** la app lo detecta sola a partir del cliente de Steam (se muestra en Ajustes). Si quieres comprobarlo: en Steam, haz clic en tu nombre → *Detalles de la cuenta*; el número de 17 cifras que empieza por `7656119…` es tu SteamID64.
3. En la app: **⚙ Ajustes → Steam**, pega la clave (y el SteamID64 si no se detectó) y pulsa **Guardar**.
4. Si Steam no devuelve juegos, revisa tu perfil: *Editar perfil → Privacidad → Detalles de juegos* no debe estar en *Privado*. La lista de deseados también tiene que ser visible para que salgan las ofertas.

La clave solo se envía a `api.steampowered.com`. Se guarda cifrada con tu usuario de Windows en `%APPDATA%\biblioteca-juegos`, fuera del código, así que nunca acabará en un repositorio.

### Fechas de compra (opcional)

La API de Steam **no** da la fecha de compra. En **Ajustes → Importar fechas de compra de Steam** se abre la página de licencias de tu cuenta en una ventana aparte. Inicias sesión tú en la web de Steam y la app lee la tabla de licencias. Esa sesión no se guarda en disco: solo se guardan las fechas. Las licencias se asocian a los juegos por nombre, así que algunas (packs, ediciones raras) pueden quedarse sin fecha.

## 2. Epic Games: vincular la cuenta (opcional pero recomendado)

Epic no tiene una API pública de biblioteca. La app combina dos fuentes:

- **Sin iniciar sesión:** la caché del Epic Games Launcher (`C:\ProgramData\Epic\EpicGamesLauncher\Data\Catalog\catcache.bin`) y los manifiestos de los juegos instalados. Para que esté al día, abre el Epic Games Launcher de vez en cuando.
- **Con [legendary](https://github.com/legendary-gl/legendary)** (un cliente de Epic de código abierto): biblioteca completa y la última versión publicada de cada juego, que se usa para avisar de las actualizaciones pendientes.

Para vincular Epic:

1. Descarga `legendary.exe` de <https://github.com/legendary-gl/legendary/releases> y déjalo, por ejemplo, en `C:\Herramientas\legendary\legendary.exe`.
2. En la app: **⚙ Ajustes → Epic Games → Buscar…** y elige ese `legendary.exe`.
3. Pulsa **Vincular Epic**. Se abre legendary y te muestra el inicio de sesión de Epic, donde entras tú. Si en vez de eso te pide un código, inicia sesión en el navegador que se abre, copia el valor `authorizationCode` y pégalo en la ventana de legendary.
4. Pulsa **Actualizar** en la app.

La app nunca ve ni guarda tus credenciales ni tus tokens de Epic: los gestiona legendary en `%USERPROFILE%\.config\legendary\`. Para desvincular, ejecuta `legendary auth --delete`.

## Qué hace cada cosa

| Función | Steam | Epic |
|---|---|---|
| Juegos en propiedad | Web API `GetOwnedGames` (o solo instalados si no hay clave) | caché del launcher + legendary |
| Carátulas | `IStoreBrowseService/GetItems` → `library_600x900` (las rutas nuevas llevan hash) | `keyImages` (`DieselGameBoxTall`) |
| Último jugado | `rtime_last_played` (o `localconfig.vdf` sin clave) | instalados: Barra de juegos de Windows (`GameConfigStore`) y log del Epic Games Launcher |
| Fecha de compra | importación desde la página de licencias | no disponible |
| Instalado / actualización | `StateFlags` de los `appmanifest_*.acf` de cada carpeta de `libraryfolders.vdf` | manifiestos `.item` comparados con la versión de legendary, más las descargas a medias de `Manifests\Pending` |
| Abrir / instalar | `steam://rungameid/<appid>` / `steam://install/<appid>` | `com.epicgames.launcher://apps/<appName>?action=launch&silent=true` / `?action=install` |
| Ofertas de deseados | `IWishlistService/GetWishlist` + precios de `GetItems` en pesos chilenos o colones costarricenses (se elige en la pestaña Ofertas), con fecha de fin | — |
| Categorías | etiquetas de la tienda (`GetItems` + `IStoreService/GetTagList`) | las del mismo juego en Steam, buscado por nombre |
| Sagas | franquicia de Steam (si su nombre sale en el título) o nombre base común | igual, a través del juego equivalente en Steam |

- **Actualizar**: vuelve a leer todo y marca como **Nuevo** lo que no estaba en la lectura anterior. Siguen marcados hasta la siguiente lectura o hasta que pulses *Marcar como vistos*.
- **Sagas**: agrupa las series de las que tienes dos o más juegos (Resident Evil, Hollow Knight, Kingdom Hearts…), uniendo Steam y Epic. Dentro de cada saga, los juegos van por fecha de salida.
- Los programas que Steam no clasifica como juegos (Wallpaper Engine, VTube Studio…) se ocultan; el botón **Programas** los muestra.
- Doble clic en un juego instalado lo abre; al pasar el ratón por encima salen los botones *Jugar* / *Instalar* y el de la tienda.

## Modo enfoque

Pulsa **Modo enfoque** (arriba) mientras juegas, o antes de abrir el juego: se activa solo en cuanto detecta uno de tus juegos instalados de Steam o Epic.

- El juego pasa a **prioridad alta** y Windows deja de aplicarle ahorro de energía.
- Los programas pesados en segundo plano (navegadores, otros launchers, Spotify, Slack, OneDrive, VS Code, Wallpaper Engine…) pasan a **modo eficiencia**: prioridad baja, EcoQoS (el "modo eficiencia" del Administrador de tareas) y memoria de baja prioridad, así Windows libera antes su RAM que la del juego.
- No se cierra nada. Los launchers que lanzaron el juego y Discord (si lo marcas en Ajustes) no se tocan.
- Si en Ajustes lo permites, cambia al plan de energía de **alto rendimiento** mientras juegas.
- Al cerrar el juego, al pulsar *Salir del modo enfoque* o al cerrar la app, **todo vuelve a como estaba**. Si la app se cerrara de golpe, lo deshace la próxima vez que la abras.
- Windows no permite reservar la GPU para un solo programa: lo que da prioridad de GPU al juego es el **Modo de juego** de Windows (Configuración → Juegos), y la app te avisa si está desactivado.

Todo funciona sin permisos de administrador, llamando directamente a la API de Windows con [koffi](https://koffi.dev/).

## Logros

La pestaña **Logros** lee tus logros de Steam (Epic no los ofrece a programas externos):

- Platinos (100 %), logros conseguidos en total y porcentaje medio.
- Cada juego con su porcentaje y lo que le falta; filtros por platinos, en progreso y sin empezar.
- Dentro de un juego: los logros que te faltan, **del más fácil al más difícil** según el porcentaje de jugadores que los tienen, con su rareza, el tipo de logro (historia, dificultad, coleccionables, en línea, desafío, acumulativo, oculto) y un consejo general; y botones para buscar la guía de ese logro en YouTube, Google y las guías de Steam.

La primera lectura consulta juego a juego (unos 40 segundos); después solo se vuelven a pedir los juegos que has jugado desde la última vez.

## Ficha de cada juego

Haz clic en cualquier juego para abrir su ficha: horas jugadas, últimas 2 semanas, última partida, fecha de compra, tamaño en disco, logros, saga y categorías. Ahí puedes:

- Marcar su **estado** (pendiente, jugando, terminado, abandonado), si es **favorito** y escribir **notas**.
- Marcar **«Voy a por el platino»**: el juego sale arriba del todo en la pestaña Logros.
- Elegir qué hace el **modo enfoque con Discord** en ese juego.
- Desinstalarlo (Steam te pide confirmación) o ir a sus logros.

En la biblioteca, el filtro **Estado** muestra favoritos, pendientes, jugando, terminados, abandonados o los **nunca jugados** (de Steam).

## Estadísticas y espacio

- **Estadísticas**: horas totales en Steam, juegos sin estrenar, lo que has jugado en las últimas 2 semanas, y las horas por juego, por saga y por categoría. Epic no da las horas a programas externos.
- **Espacio**: cuánto ocupan los juegos en cada unidad frente al resto de archivos, lo que más ocupa y qué podrías desinstalar (instalados que no juegas desde hace más de 90 días).

## Juegos gratis de Epic

La pestaña **Ofertas** muestra arriba los juegos gratis de Epic de esta semana y los próximos, y marca los que ya tienes. Cuando aparece uno nuevo, Windows te avisa la siguiente vez que abres la app.

## Más del modo enfoque

- Se activa solo al pulsar **Jugar** en la app (se puede quitar en Ajustes).
- **Discord**: por defecto no se toca en juegos multijugador o cooperativos; en Ajustes puedes elegir no tocarlo nunca o frenarlo siempre, y cada juego puede tener su propio ajuste en su ficha.
- **Panel de rendimiento**: en el panel del modo enfoque ves CPU, GPU (3D), RAM del PC, RAM del juego y VRAM. Si lo activas, aparece un panel flotante pequeño encima del juego (se ve en modo ventana o ventana sin bordes; en pantalla completa exclusiva el juego lo tapa).
- Mientras juegas a un juego de Steam con el enfoque activo, la app mira cada 2 minutos si has conseguido algún logro y te avisa.

## Logros con amigos

En la ficha de logros de un juego, **Comparar con mis amigos** muestra el porcentaje de tus amigos de Steam (los que tienen el perfil público) y, en cada logro que te falta, quién lo tiene ya.

## Recientes en la barra de tareas

Haz clic derecho en el icono de la app en la barra de tareas: salen tus últimos juegos instalados. Si la app está cerrada, abre el juego directamente sin cargar la ventana.

## Registro de partidas (también Epic)

Mientras la app está abierta (o minimizada), mira cada 30 segundos qué juego instalado tienes abierto y apunta cuándo empieza y termina cada partida. Así hay **horas de Epic**, que Epic no da, y detalle por día. Si cierras la ventana con un juego abierto, la app sigue contando sin ventana y se cierra sola al terminar la partida (se puede desactivar en Ajustes).

En **Estadísticas** verás los últimos 14 días, las horas por juego registradas por la app y el **resumen del mes** (horas, logros, platinos y juegos terminados), que puedes guardar como imagen.

## ¿A qué juego?

El botón de arriba propone 3 juegos según el tiempo que tengas, lo que te apetezca y lo que tienes a medias o pendiente.

## Búsqueda rápida

**Ctrl+K** desde cualquier sitio: escribe unas letras y pulsa Enter para jugar (Mayús+Enter abre la ficha).

## Amigos

Quién de tus amigos de Steam está conectado y a qué juega, y qué juegos multijugador o cooperativos tenéis en común (solo con amigos que tengan el perfil público).

## Novedades

Anuncios y parches oficiales de tus juegos instalados, favoritos y pendientes (de las noticias de Steam), los próximos lanzamientos de tu lista de deseados y **noticias de Nintendo** de [Nintenderos](https://www.nintenderos.com/) (en español) y [Nintendo Life](https://www.nintendolife.com/) (en inglés), leídas de sus RSS públicos.

## Capturas y partidas guardadas

- La ficha de cada juego muestra sus **capturas** de Steam (F12) y de la Barra de juegos de Windows.
- **Partidas guardadas**: la app sabe dónde guarda cada juego sus partidas gracias a la base de datos abierta de [Ludusavi](https://github.com/mtkennerly/ludusavi-manifest). Desde la ficha (o desde *Espacio*, para todos los instalados) puedes copiarlas a `Documentos\Biblioteca de juegos - partidas guardadas` (o a la carpeta que elijas en Ajustes, por ejemplo **OneDrive o Google Drive** para tenerlas en la nube) y restaurarlas; antes de restaurar se guarda una copia de lo que haya.

## FPS

Con el modo enfoque activo, el panel de rendimiento y el panel flotante muestran los **FPS** del juego y el «1 % más bajo», medidos con [PresentMon](https://github.com/GameTechDev/PresentMon) (de Intel, licencia MIT, incluido en el instalador). Funciona sin administrador si tu usuario está en el grupo de Windows «Usuarios del registro de rendimiento». Algunos juegos con antitrampas no dejan medirlos.

## Exportar e importar tus datos

En Ajustes puedes exportar tus estados, notas, favoritos, sesiones y ajustes a un archivo (sin tu clave de Steam) e importarlos en otro PC.

## Al terminar cada partida

Cuando cierras un juego, la app te enseña un resumen (tiempo, FPS medio y «1 % más bajo» si usabas el modo enfoque, y logros conseguidos), lo guarda en el historial de la ficha y copia sus partidas guardadas (se quedan las 5 últimas copias automáticas de cada juego; las manuales no se borran).

## Tiempo de juego

En Ajustes puedes poner un límite diario y un recordatorio cada cierto tiempo, y recibir un resumen de la semana pasada.

## Más avisos

- El último día de un juego gratis de Epic que no tienes.
- Cuando un amigo de Steam se pone a jugar a algo que tú también tienes.
- **Ctrl+Alt+F** activa o quita el modo enfoque desde cualquier sitio, también dentro del juego.

## Valoraciones

Puntúa cada juego de 1 a 5 estrellas en su ficha. La biblioteca se puede ordenar por tu nota y en Estadísticas sale tu top del año.

## Vitrina de logros

En Logros: tus logros más raros, los últimos que conseguiste y tu racha de días seguidos consiguiendo alguno.

## Más espacio

En Espacio, las **cachés** de sombreadores de Steam, DirectX y los drivers de tu gráfica (se borran solo si lo confirmas y se vuelven a crear solas) y los juegos que tienes **instalados dos veces** (en Steam y en Epic).

## Novedades de la 1.4

La app pasa a llamarse **ViperTeca**, con su logo (`build/brand/`).


- **Otras tiendas**: los juegos *instalados* de Riot, Rockstar, GOG, EA app y Ubisoft Connect (se leen del registro y de sus archivos locales; esas tiendas no dan la lista completa de lo que tienes). El filtro **Otras** los agrupa.
- **Modo mando**: con un mando de Xbox o compatible, muévete con la cruceta o el stick. A abre, B vuelve, Y juega, X «¿A qué juego?», LB/RB cambian de sección, Start pone pantalla completa y Select el modo enfoque.
- **Para ti**: recomendaciones de las tiendas de Steam y Epic según las categorías que más juegas y mejor puntúas, y «más como esto» de tus favoritos. No salen los que ya tienes ni los de tu lista de deseados.
- **En la ficha**: tráileres de Steam (también en juegos de otras tiendas, a través del mismo juego en Steam), **parecidos a este** en tu biblioteca (marcando los que no has estrenado), **colecciones propias** (luego se filtran en *Estado*) y **¿Lo mueve tu PC?** en los juegos sin instalar.
- **Ofertas**: cada deseado dice si tu PC lo mueve (requisitos de Steam frente a tu procesador, gráfica y RAM; la comparación es aproximada) y hay una sección de **DLC rebajados** de los juegos que más juegas.
- **En el móvil** (sección *Tu PC*): enciende una página en tu Wi-Fi, escanea el QR y verás tus juegos en el teléfono; desde ahí puedes abrir en el PC los instalados. El enlace lleva un código secreto, solo deja ver la lista y abrir juegos, y se apaga al cerrar la app.
- **Apariencia**: modo claro, oscuro o el de Windows; siete paletas de colores para toda la interfaz (ViperTeca, Noche, Océano, Bosque, Sakura, Atardecer, Grafito) o una **a tu gusto** eligiendo el color principal y el tono del fondo; y el arte de un juego de fondo (en Ajustes o con *Usar de fondo* en su ficha).
- **Trucos con [Wand](https://wand.com/)** (antes WeMod): la app lee el catálogo público de Wand y marca qué juegos tuyos tienen trucos. En la ficha, **Trucos** abre ese juego directamente en Wand (o su página web si no lo tienes instalado), y el filtro *Estado → Con trucos (Wand)* los muestra todos. Los trucos los gestiona Wand; úsalos solo en partidas de un jugador.
- **Aviso de rebajas**: cada 6 horas mira tu lista de deseados de Steam y te avisa cuando un juego se rebaja o baja más (se puede quitar en *Ajustes → Tiempo y avisos*).
- **Enlaces útiles en la ficha**: guías en YouTube, mods en Nexus Mods y cuánto dura en HowLongToBeat.
- **Ficha nueva**: el arte del juego arriba, *Jugar* y las acciones a mano, y la información en dos columnas.
- **Exportar la biblioteca**: a CSV para Excel (horas, estados, notas, colecciones…) o a una página web con tus carátulas para compartir. Las notas solo se incluyen si lo marcas.

## Tu perfil de Genshin Impact

Si tienes Genshin, en el menú aparece **Genshin**. Pega tu **UID** (9 o 10 cifras; sale abajo a la derecha en el juego) y verás, desde [Enka.Network](https://enka.network/):

- Rango de aventura, nivel de mundo, logros, piso del Abismo y personajes con amistad 10.
- Los personajes de tu **vitrina**: nivel, constelación, talentos, estadísticas, arma y artefactos (con sus conjuntos y el valor crítico).

El UID no es una contraseña: no se inicia sesión en ningún sitio. Para que se vean armas y artefactos, en el juego activa *Menú de Paimon → tu perfil → Editar vitrina → Mostrar detalles de personajes*. El inventario y los personajes que no están en la vitrina no son públicos, así que no se pueden mostrar.

La sección Genshin tiene además estas pestañas:

- **Noticias y eventos**: días que faltan para la próxima versión, el directo que la presenta (estimado hasta que HoYoverse lo anuncia), los personajes nuevos en cuanto se presentan, los gachapones actuales, todos los eventos en curso con lo que les queda y las noticias oficiales de HoYoLAB. Sale de los anuncios del propio juego y de HoYoLAB, sin iniciar sesión.
- **Prioridades**: tu lista de cosas por hacer (misiones, subir personajes, farmeo). Genshin no comparte tus misiones con ningún programa, así que la app las lee de una **captura del diario de misiones** con el reconocimiento de texto de Windows, sin conexión y sin tocar el juego (botón o **Ctrl+Alt+M** dentro del juego). Si vinculas HoYoLAB, aquí salen solas la resina, los encargos, los jefes semanales y las expediciones pendientes.
- **Notas de HoYoLAB**: con tu cuenta de HoYoLAB (inicias sesión tú en una ventana de la app; se guarda solo la sesión de lectura, cifrada), la resina, los encargos, los jefes semanales, las expediciones, la moneda del reino, el resumen completo de la partida (cofres, óculos, teletransportes…), la exploración por región y la ficha completa de **todos** tus personajes: atributos, arma, constelaciones, talentos y artefactos con cuántas veces subió cada atributo. La API de HoYoLAB no es oficial y puede cambiar.
- **Deseos**: abre *Deseos → Historial* en el juego y pulsa *Importar historial*. La app lee el enlace temporal que deja el juego en tu PC y guarda tus tiradas: pity de cada banner, si el próximo 5★ está garantizado y tus 5★ con el número de tiradas.

## Spotify

En **Música → Spotify** vinculas tu cuenta con el inicio de sesión oficial de Spotify (necesitas crear una vez una app gratuita en [developer.spotify.com](https://developer.spotify.com/dashboard) y pegar su *Client ID*; la app lo explica paso a paso). Verás tus playlists, *Canciones que te gustan*, lo que más escuchas, lo reciente, tus artistas y **Para ti** (lo más escuchado de tus artistas favoritos que aún no oyes). Con **Premium** puedes reproducir y cambiar de playlist desde ViperTeca: suena en tu app de Spotify (Spotify Connect) y abajo aparece una barra con pausa, siguiente, aleatorio, volumen y dónde suena.

## Workana

**ViperTech → Workana** busca proyectos nuevos en Workana con tus palabras clave (por defecto: wordpress, elementor, woocommerce, landing page, página web, desarrollo web) y te los comenta uno a uno: qué piden, la tecnología, el presupuesto del cliente, cuántas propuestas tiene y si el cliente tiene el pago verificado y buena valoración. Puedes filtrar por pago verificado y ordenar por los más nuevos, el mayor presupuesto o los que tienen menos propuestas.

Escribes tu precio y pulsas **Preparar propuesta**: la app la redacta con tu estructura de siempre, elige como referencia dos de tus proyectos destacados del perfil (Silkglobal, Butori Insumet, Salva Vidrios…), añade siempre tu línea de portafolio (`📂 Portafolio: vipertechcr(.)com/proyectos …`, que las reglas no tocan) y aplica las reglas de Workana al resto del texto: sin enlaces ni dominios, sin números, sin palabras de contacto (correo, teléfono, WhatsApp…) y «Nextjs» sin punto. Si editas el texto y algo no cumple, lo marca y puede corregirlo.

**Postular** abre el proyecto en una ventana de ViperTeca con tu sesión de Workana (la primera vez inicias sesión tú, con tu usuario y contraseña; queda guardada solo en esa ventana). La app pasa sola al formulario de propuesta, escribe el texto y tu precio, y te deja revisar: completas el plazo si te lo pide y pulsas **Enviar** tú. ViperTeca nunca envía la propuesta por su cuenta, porque Workana no permite postular con programas automáticos. Al cerrar la ventana te pregunta si la enviaste para marcarla como postulada. **Copiar y abrir en el navegador** sigue disponible: copia la propuesta y abre el proyecto en tu navegador. Marca *Ya postulé* para que no vuelva a salir. La búsqueda lee la página pública de trabajos de Workana con una ventana oculta de la app, solo cuando pulsas *Buscar*.

## Resto Experience

Tres apartados para el trabajo, en la sección **Resto Experience** del menú.

**Calendario**: tus próximas reuniones de Google Calendar, la siguiente con su botón para unirte a Meet, tu día en una franja horaria, tus dailys y la agenda de las próximas dos semanas. Marca las reuniones nuevas y las que aún no respondiste. Cada 5 minutos revisa el calendario y te avisa si te agendan una reunión o si cambia una hora, y también 5 minutos antes de cada reunión (los dos avisos se apagan en *Avisos*). Para conectarlo pegas tú la **dirección secreta en formato iCal** de tu calendario (Google Calendar → Configuración → tu calendario → Integrar el calendario). Es de solo lectura y se guarda cifrada con tu usuario de Windows. Si tu cuenta de empresa no muestra esa opción, la tiene desactivada el administrador de Google Workspace.

**Notion**: pulsas *Conectar con Notion*, aceptas en tu navegador y listo (OAuth con el servidor oficial de Notion; la app nunca ve tu contraseña y solo lee). Verás tus tickets de *Tickets General* donde eres responsable, en tres columnas (por hacer, en curso y cerrados el último mes), con prioridad, fecha límite (vencidos en rojo), fecha de creación y el resumen. La app lee el chat de cada ticket abierto y te dice si **queda algo pendiente**, si estás esperando respuesta o si parece listo; al abrir un ticket ves el chat completo. La pestaña *Pipeline de webs* muestra todas las webs por estado (tus webs o todo el equipo) con tipo, tecnología, entrega, enlaces a GitHub, staging y producción, y el estado de tu copia local.

**Websites**: revisa cada carpeta de `Escritorio\Vincenzo\Resto Experience\Webs` (se puede cambiar). *Revisar con GitHub* hace `git fetch` en cada repo con tus credenciales de git y te dice cuáles necesitan `git pull`, cuáles tienen cambios sin commit o commits sin subir, si tu rama va por detrás de main y cuál fue el último commit en GitHub. *Hacer git pull* solo aparece cuando la carpeta está limpia (usa `--ff-only`, así nunca pisa tu trabajo), y avisa si cambiaron las dependencias.

## Editor de código con Claude (Websites)

En **Websites**, cada web tiene **Abrir en el editor**: se abre su carpeta con un árbol de archivos (crear, renombrar y mandar a la papelera), pestañas y el mismo editor de VS Code (Monaco: colores, minimapa, autocompletado básico). Ctrl+S guarda.

A la derecha está el chat con **Claude**: usa el Claude Code que ya tienes instalado, con tu sesión y tu plan, sobre la carpeta de esa web. Eliges el modelo (Opus, Sonnet o Haiku), el esfuerzo y los permisos (solo leer, leer y editar archivos, o también ejecutar comandos como npm o git). Ves en vivo qué archivos lee o edita y, si cambia uno abierto, el editor lo recarga solo. Con «Incluir el archivo abierto» le pasa el archivo y lo que tengas seleccionado. La conversación de cada web se guarda y sigue donde la dejaste. En la barra de abajo: la rama de git, la posición del cursor y, en la esquina, el **% de contexto** que lleva la conversación con Claude y el estado de tu límite de 5 horas.

## Email

**ViperTech → Email** muestra la bandeja de entrada de tu correo de Hostinger (contacto@vipertechcr.com) por IMAP, en modo solo lectura: quién te escribió, el asunto, la hora y cuáles están sin leer, sin marcarlos como leídos. Revisa cada 5 minutos y te avisa de los correos nuevos. La contraseña la escribes tú y se guarda cifrada en este PC. Para leer o responder, «Abrir Webmail de Hostinger».

## LinkedIn

**ViperTech → LinkedIn** tiene tres pestañas. *Buscar ofertas*: busca con tus preferencias (puestos o tecnologías, lugares, modalidad y si son del último día, semana o mes) en el buscador público de empleos de LinkedIn, sin usar tu cuenta; marca las nuevas desde la última búsqueda y, al abrir una, muestra la descripción, el tipo de empleo, el nivel y cuántos se postularon. *Recomendadas para ti* y *Mis postulaciones* se abren en Brave, donde ya tienes la sesión; con «Traerlas a ViperTeca» la app las lee y muestra aquí: la primera vez se abre LinkedIn en una ventana de la app y entras tú, y desde ahí la app solo las lee cuando pulsas «Traerlas a ViperTeca» (dónde te postulaste, cuándo y si vieron tu solicitud o descargaron tu CV). También puedes llevar el seguimiento de cada oferta (guardada, postulé, entrevista, oferta…). Las ofertas se abren en Brave para postularte. ViperTeca no postula ni escribe en LinkedIn. LinkedIn limita las búsquedas seguidas: si corta, espera unos minutos.

## Novedades: juegos, anime y Nintendo

**Novedades** tiene tres pestañas. *Juegos*: arriba lo próximo que sale de tu lista de deseados (con cuenta regresiva), y debajo los anuncios de tus juegos en tarjetas con su portada, el más reciente destacado, filtrables entre parches y anuncios. *Anime*: los estrenos más esperados y las próximas tres temporadas, con portada oficial, fecha, estudio, dónde se ve, géneros, tráiler y sinopsis (de AniList, en inglés); un buscador para cualquier anime y **Mi calendario**, con los que añades y los que pongas a mano, en lista o en calendario mensual. Te avisa el día antes del estreno, el mismo día y cuando sale cada episodio nuevo. *Nintendo*: las noticias de siempre.

## Novedades de la 1.35

- **Puente del control**: los televisores TCL reservan el botón R1 del control como tecla del sistema y no se lo pasan a ninguna app («Not Support Key»). ViperTeca ahora lee el control directamente en la tele, antes de que el sistema lo interprete, y lo reproduce en un control de Xbox virtual en el PC. El juego recibe todos los botones, R1 incluido, con el control conectado por Bluetooth a la tele. Se enciende solo al jugar «En el televisor» y sigue activo mientras ViperTeca esté abierto; se puede apagar desde ese mismo cuadro.
- Usa el controlador ViGEmBus (gratuito) y Moonlight + Sunshine para todos los juegos; el control propio de Sunshine queda apagado para que el juego no vea dos.

## Novedades de la 1.34.1

- **En el televisor**: si el televisor elegido no tiene la depuración por red encendida, ViperTeca busca en la wifi de casa el que sí la tiene, lo añade con su nombre y lo elige solo. «Añadir por IP» siempre está a mano.

## Novedades de la 1.34

- **En el televisor**: en cada juego instalado hay un botón para jugarlo en la tele con tu control (por ejemplo el de PS5). El juego corre en el PC y se transmite: los de Steam con **Steam Link** y los de Epic y demás con **Moonlight** en la tele + **Sunshine** en el PC. ViperTeca abre el juego en el PC y la app en la tele.
- La primera vez muestra lo que falta: elegir el televisor (o añadirlo por su IP), abrir Steam Link o Moonlight en la Play Store de la tele para que pulses Instalar, la página de descarga de Sunshine y cómo vincular el control de PS5 en la tele. Usa la depuración por red (ADB) del televisor.

## Novedades de la 1.33

- **Diseño nuevo en toda la app**: fondos grafito (antes se teñían del color de la paleta y quedaban turbios), cuatro alturas de superficie bien separadas (página, panel, tarjeta e interior), bordes finos, sombras suaves y una textura de grano muy sutil en el fondo y las tarjetas.
- **Colores con significado fijo** en todas las paletas: verde es «bien», ámbar «atención», rojo «problema» y celeste «dato o enlace». El color de tu paleta queda para la marca, lo seleccionado y el botón principal; el de rebajas, solo para las ofertas.
- Tipografía más ordenada: títulos y cifras en Bahnschrift con números de ancho fijo (las columnas ya no bailan), textos en Segoe UI con mejor contraste, pestañas, botones, campos, tablas y etiquetas con las mismas medidas en todas partes.
- **La semana del equipo** (Websites → Squads): debajo de cada frase salen los tickets de Notion, las webs del pipeline y las ramas de GitHub de las que habla, para abrirlos con un clic. Los resúmenes nuevos los marcan exactos; en los ya preparados se buscan por el título.

## Novedades de la 1.32

Más para Resto Experience, en **Websites**:

- **Clientes → Webs**: la ficha de cada web suma el contacto del cliente (lo anotas tú), sus tickets abiertos de Notion, su estado en el pipeline y los últimos deploys de Vercel.
- **Clientes → Reseñas**: las reseñas de Google de cada local de los restaurantes. Las de 3★ o menos de los últimos 60 días salen arriba con una respuesta sugerida (en el idioma de la reseña) para copiar y pegar en Google. Se revisan una vez al día y te aviso de cada negativa nueva. Usa tu clave de Google de Salud de las webs con «Places API (New)»; Google solo comparte las 5 reseñas más relevantes de cada local.
- **Clientes → Vencimientos**: dominios, certificados SSL y las suscripciones de los clientes (hosting, plugins, licencias…) en un solo calendario por mes. Las suscripciones las añades tú y te aviso 30 y 7 días antes.
- **Clientes → Incidentes**: cada caída que ve el monitor entra sola, con su duración. Anotas la causa y qué se hizo, o Claude las redacta con los deploys de Vercel de ese día.
- **Equipo dev** (pestaña nueva): PRs que llevan más de 2 días sin revisión y quién tiene que revisarlos; deploys que fallaron, quién los rompió, el motivo del build y si ya se arreglaron; tiempo de ciclo por persona y por web (PR abierto → fusionado → en producción); la retro del sprint de cada squad, lista para copiar en Slack; y quién conoce cada web (las que solo ha tocado una persona en 6 meses, para cubrir ausencias).
- **Vercel y versiones** (pestaña nueva): lo que gasta Vercel este mes por proyecto y servicio, la proyección a fin de mes y un aviso si va a pasar de tu límite (o del mes pasado + 20 %) o si un proyecto se dispara de un día a otro; las versiones de Next.js, React, Tailwind y demás en cada web frente a la última; las variables de entorno de preview que faltan en producción (solo los nombres, nunca los valores); y los previews de ramas sin fusionar que llevan más de 2 semanas quietos.

Todo se lee de GitHub (con tu sesión de `gh`), Vercel (tu token) y Google: ViperTeca no cambia nada allí.

## Novedades de la 1.31.3

- **Televisores**: encender, apagar, volumen y abrir apps ahora sí llegan al televisor. Al conectarse, ViperTeca le pedía funciones que el televisor no tiene (como la voz), así que el televisor no lo aceptaba como control y no hacía caso a las teclas. Ahora pide solo las que el televisor ofrece. Mientras se conecta, la tarjeta dice «Conectando…», y si el televisor rechaza una orden, lo muestra.

## Novedades de la 1.31.2

- **Música (Spotify)**: las canciones de las playlists vuelven a cargar. Spotify cambió su API en marzo de 2026 y las apps personales ya no pueden usar la ruta antigua; ViperTeca usa la nueva. Esas apps ahora solo pueden ver las canciones de playlists tuyas o colaborativas; en las de otras personas sale el motivo y botones para reproducirla igual o abrirla en Spotify, en vez de quedarse «Cargando canciones…».
- «Me gusta» y «Para ti» usan también las rutas nuevas, y ya no se muestra si la cuenta es Premium o gratis (Spotify dejó de decirlo).

## Novedades de la 1.31.1

- **Televisores**: las apps se abren como app (Crunchyroll, Netflix, YouTube…), no en el navegador. Cada televisor tiene su lista: las más comunes y las que vas abriendo en él; con «Leer las apps instaladas» aparecen todas las del televisor. Para eso hay que activar una vez la depuración del televisor (la app explica los pasos y el televisor pide permiso con un aviso que aceptas tú); ViperTeca solo lee la lista.

## Novedades de la 1.31

- **Casa → Televisores**: los televisores con Google TV o Android TV de la casa (como los TCL) aparecen solos al pulsar «Buscar televisores». Se vinculan una vez: el televisor muestra un código de 6 caracteres y lo escribes en la app. Después: encender, apagar, subir y bajar volumen (o ponerlo exacto con la barra), silencio, reproducir o pausar, inicio y abrir Netflix, YouTube, Crunchyroll, Spotify, Disney+ o Max. Muestra qué app está abierta y, si algo se transmite (Chromecast, Spotify, YouTube desde el celular), el título con su portada y si está en pausa.
- **En el iPhone**: Casa → TV, con encender/apagar, volumen, silencio, pausa y lo que se está viendo en cada televisor.
- Para encenderlos desde la app cuando están apagados, activa en cada televisor Ajustes → Sistema → Energía → la opción de encender por la red o con Chromecast. Todo pasa dentro de la wifi de casa; la llave de ViperTeca para los televisores se guarda cifrada en este PC.

## Novedades de la 1.30

- **Copias de seguridad** (en Tu PC): las copias diarias de OneDrive, día por día. «Ver qué tiene» compara la copia con lo de ahora (por ejemplo «7 pagos · 12 regalos») y «Restaurar» devuelve solo ese archivo al día que elijas; lo de ahora se guarda antes en «antes-de-restaurar», por si acaso. Ahora se copian también las notas de los 1:1, el diario de partidas, el gasto en juegos, los historiales de precios, el uptime y la velocidad de las webs, Viendo y más, y se guardan 30 días (antes 10).
- **Calendario de juego**: en la agenda, debajo de tus reuniones, los próximos 30 días de juegos: cuándo terminan las ofertas de tu lista de deseados, los gratis de Epic (cuándo empiezan y terminan), los eventos de Genshin que terminan, los reinicios del Abismo y del Teatro, la próxima versión y los lanzamientos de tu lista.
- **Diario de partidas**: al cerrar una partida de más de 15 minutos sale una ventanita para anotar dónde lo dejaste; la próxima vez que abras ese juego, la nota aparece arriba de la pantalla. Todas las notas están en la ficha de cada juego, donde también puedes añadir más.
- **Juegos olvidados**: Espacio en disco muestra cuánto ocupan en total los juegos instalados que no abres hace 3 meses, y si pasan de 50 GB te aviso una vez al mes.
- **Genshin → Equipos**: cuando se reinicia el Abismo (día 16) o el Teatro (día 1), tu Claude Code prepara solo los equipos de la nueva temporada con tus personajes y te avisa.

## Novedades de la 1.29

- **Casa → Suscripciones**: Netflix, Spotify, Game Pass y demás con su precio, cada cuánto se cobran y la próxima renovación; cuánto suman al mes y al año en colones (los dólares con el tipo de cambio del día). Te aviso 3 días antes y el día de cada renovación (y la fecha pasa sola a la siguiente).
- **Correo personal (facturas y suscripciones)**: conecta tu correo personal (en Gmail, con una contraseña de aplicación que creas y pegas tú; se guarda cifrada en este PC). Una vez al día ViperTeca lee, sin marcar nada, solo los correos con «factura», «recibo», «suscripción», «receipt»… Tu Claude Code reconoce las facturas de luz, agua o internet y las anota solas en Pagos con su monto y vencimiento (sin marcarlas pagadas), y añade o actualiza las suscripciones que encuentra.
- **Casa → Gatitos → Comida y arena**: con el tamaño de la bolsa y cuánto se usa al día, ves cuántos días quedan; 5 días antes te aviso y lo pongo en la lista de compras. «Abrí una nueva» empieza a contar desde hoy.
- **Casa → Vehículo**: cargas de gasolina (kilometraje, litros y lo pagado) con el consumo en km por litro y el gasto de los últimos 30 días; mantenimientos (aceite, llantas, frenos…) cada tantos km o meses, con aviso cuando faltan 500 km o 2 semanas. El Riteve y el marchamo siguen en Trámites.
- **Conexiones** (en Tu PC): Steam, Epic, Notion, Vercel, los dos correos, el calendario, HoYoLAB, Spotify, Netflix, Crunchyroll, GitHub, la clave de Google, el iPhone y Claude Code, cada una en verde, amarillo (sin datos recientes), gris (sin conectar) o rojo (falla), con el botón para reconectar. Se revisan cada 30 minutos y te aviso si una que estaba bien se cae.

## Novedades de la 1.28

- **Estadísticas → Gasto en juegos**: abre tu historial de compras de Steam o Epic en una ventana de la app, inicias sesión tú y pulsa «Leer». Muestra cuánto gastaste por año (en colones, con el tipo de cambio del día) y cuánto te costó cada hora jugada: lo que mejor y lo que peor rindió.
- **Ofertas → PC Game Pass**: el catálogo de PC Game Pass cruzado con tu lista de deseados (los que ya están, los que se van pronto y los que llegaron). Te aviso cuando un deseado llega o se va.
- **Ofertas → Próximos lanzamientos de tu lista**: con la fecha y si tu PC lo mueve (recomendado, mínimo o no llega). Te aviso 3 días antes, el día anterior (para dejarlo precargando) y el día que sale.
- **Amigos → Para jugar ahora**: los juegos multijugador que tienes en común con los amigos que están conectados, con el botón Jugar.
- **Pausas al jugar**: cada 2 h seguidas (o el intervalo que pusiste en Ajustes) sale un aviso suave arriba de la pantalla, sin sonido ni notificación de Windows, para estirarte y tomar agua. Se apaga en Estadísticas.
- **Genshin → Tiradas**: el cálculo de protogemas hasta la fecha cuenta por separado las diarias, la Luna, el Abismo (día 16), el Teatro (día 1), los eventos, los códigos y el mantenimiento, el Pase Gnóstico y los destinos de la tienda de Paimon, con el desglose de dónde sale cada cosa.
- **HoYoLAB**: si a las 8 de la noche sigue sin hacerse el check-in, un segundo recordatorio.

## Novedades de la 1.27

- **Panel del case siempre visible**: mientras ViperTeca esté abierta, el panel con todas las estadísticas se pone solo de fondo en la tercera pantalla (la vertical). Cada 15 segundos se comprueba que siga ahí: si la pantalla estaba apagada al arrancar, si Windows la reconoce tarde, si cambia la resolución o vuelve de la suspensión, el panel vuelve a su sitio. Si la pantalla no está, se espera a que vuelva (no tapa la principal).
- **Websites → Clientes**: una tarjeta por web de cliente con todo junto: uptime de 30 días (se revisa cada 5 minutos) y tiempo de respuesta, vencimiento del dominio (avisos a 30 y 7 días) y del SSL (a 30 y 7 días), Core Web Vitals reales de Chrome (CrUX) y PageSpeed cada semana con su tendencia, horarios de la web frente a los de Google (Places API, comparados por tu Claude Code), contenido vencido (popups y promos de fechas pasadas, fiestas fuera de temporada, © de otro año), capturas diarias de la portada en escritorio y celular con el cambio respecto al día anterior, seguridad del repo (alertas de Dependabot, la versión de Next.js con fallos y a cuál actualizar, claves subidas por error) y horas de trabajo estimadas del mes por los commits.
- **Informe mensual en PDF** por cliente (en inglés o español): uptime, caídas, publicaciones, cambios del mes explicados para el dueño del restaurante, velocidad, SSL y dominio, y la revisión técnica. Se guarda en Documentos\ViperTeca\Informes\AAAA-MM. «Cambios del mes» da el texto para copiar.
- **Squads**: standup de cada squad listo a las 9 (lunes a viernes) para pegar en Slack; tickets en riesgo (vencen en 3 días y su web no tiene commits recientes); comentarios sin responder en Notion (más de 48 h); carga del equipo con sugerencias de reparto; y «Preparar el 1:1» con su semana, lo que hay que hablar y las notas de las reuniones anteriores.
- **Tickets**: los vencidos hace más de 2 semanas se dan por hechos (antes, más de un mes).
- **Menos avisos**: las actualizaciones de Next.js y el contenido vencido ya no lanzan avisos de Windows; se ven en Websites → Clientes. Avisa solo lo urgente: webs caídas o lentas, dominios y SSL que vencen, claves expuestas, horarios distintos de Google y portadas que cambian mucho.
- Para CrUX y los horarios usa la misma clave de Google de Salud de las webs, con «Chrome UX Report API» y «Places API (New)» activadas en Google Cloud.

## Novedades de la 1.26

- **Regalos que bajan de precio**: una vez al día ViperTeca vuelve a leer el precio de cada regalo con enlace (ideas sin comprar), guarda el historial y te avisa si baja («Bajó 22 %: Perfume · $50 → $39 · el más bajo que he visto · de la lista de Emi»). La tarjeta muestra cuánto bajó y, al pasar el ratón, el precio de cada día. «Revisar precios» lo hace en el momento.
- **Fechas importantes**: en Regalos salen el cumpleaños de Emi, Navidad y las fechas que añadas (aniversario, Día de la madre…) con cuántos deseos siguen sin comprar y cuánto suman (en dólares y colones). Te aviso 21, 7 y 2 días antes.
- **Recibos por foto**: en Pagos (y en el iPhone, Casa → Pagos → Tomar foto) sube la foto de un recibo de luz, agua o internet. Tu Claude Code lee el monto, el vencimiento, el mes y a qué pago corresponde; confirmas y queda anotado y pagado. La foto no se guarda.
- **Servicios mes a mes**: en Pagos, un gráfico de los últimos 12 meses de cada servicio con lo que vino cada mes y el cambio frente al promedio; si un mes viene un 25 % más alto, te aviso. «Anotar monto» para los meses sin recibo. El presupuesto usa el monto real del recibo.
- **Compras con Emi en vivo**: su página tiene ahora la pestaña «Compras de la casa»: ve la lista, añade lo que falta y marca lo comprado; se actualiza sola y en ViperTeca aparece al instante (con «tuyo» en lo que añadió ella).
- **Websites → Lanzamientos**: cuando una web pasa a Live en Notion la reviso sola y te aviso con la lista de pendientes; también se puede revisar cualquier web a mano. Revisa que cargue, Google Tag Manager / Analytics, el pixel de Meta, el formulario, el SEO básico (título, descripción, imagen para compartir, H1, noindex, canonical, robots.txt, sitemap, idioma, favicon, textos alternativos), el celular (que no se mueva de lado, textos pequeños) y enlaces rotos o errores de JavaScript.
- **Squads → ramas olvidadas y trabajo sin ticket**: en «La semana del equipo», las ramas con commits que llevan más de una semana sin pasar a main (sin contar las del agente de SEO ni las ya fusionadas) y las webs con trabajo esta semana que no aparecen en ningún ticket de Notion.
- **Viendo → Noche de serie**: eliges cuánto tiempo hay (30 min a 2 h) y propone qué ver: primero lo que están viendo los dos, con cuántos capítulos entran.
- **Capítulos nuevos**: aviso (también en el iPhone) cuando sale un capítulo nuevo de algo que siguen en Netflix o Crunchyroll.
- **Tu semana en el iPhone**: en Hoy, una tarjeta con lo jugado, las series, lo gastado, los pagos de la semana que viene, cumpleaños cercanos, fechas para regalar y trámites; el domingo y el lunes sale arriba.
- Arreglado: Pagos decía «Todo pagado este mes» cuando quedaban pagos sin monto anotado.

## Novedades de la 1.25

- **Regalos desde el celular de Emi**: en Casa → Regalos, «Enlace para Emi» muestra el QR de su página «Mis deseos». Emi pega el enlace de un producto (no hace falta foto) y el regalo aparece al instante en ViperTeca; la foto, el nombre, el precio con su moneda y la tienda se completan solos en unos segundos, y te llega un aviso. También puede añadir algo sin enlace, con una nota, o para otra persona. Su página tiene su propio código: solo deja añadir y ver lo que ella añadió (no ve tus ideas ni si ya compraste algo). Funciona en la wifi de casa y, si su celular está en tu Tailscale, desde cualquier lugar. «Cambiar el enlace» invalida el anterior.
- **Leer un producto desde el enlace**: al crear un regalo en el PC, pega el enlace y se completan el nombre, la foto y el precio. Lee los datos de la tienda (Amazon, Apple, LEGO y la mayoría de tiendas con datos de producto); si la tienda arma la página con JavaScript, la abre en una ventana oculta, sin tu sesión. La foto se guarda pequeña dentro de la app. Solo se aceptan direcciones públicas.

## Novedades de la 1.24

- **Websites → Squads → La semana del equipo**: qué trabajó esta semana cada responsable (Vincenzo, Camila Jouce, Luis Chrestia, Emily) y en qué seguirá la próxima, con lo que tu Claude Code saca de tres fuentes: los commits y ramas de GitHub de la organización (con la sesión de GitHub CLI de este PC, `gh auth login`), los deploys a producción de Vercel y los tickets de Notion. Muestra commits, deploys, tickets cerrados y deploys fallidos de cada uno, y lo que conviene vigilar. Se prepara solo una vez cada 12 horas al abrir Squads, o con «Volver a preparar». Las cuentas de GitHub y Vercel de cada persona se pueden cambiar en `settings.json` (`teamIds`).
- **Notion con una sola cuenta**: basta con tu conexión. ViperTeca lee los tickets de los cuatro responsables en una sola lectura (por páginas, una tras otra) y los reparte por el campo Responsible. Arreglado el fallo que desconectaba Notion: dos consultas renovaban la sesión a la vez y Notion invalidaba la segunda. Si la conexión falla sale un solo aviso con el botón «Conectar Notion».

## Novedades de la 1.23.2

- **Tickets vencidos hace más de un mes**: ViperTeca los da por hechos (solo en la app; en Notion siguen igual). No cuentan como abiertos ni vencidos en Squads, Notion ni Mi día, y la tarjeta de cada squad dice cuántos se dieron por hechos.
- **Squads**: los nombres de las webs del pipeline salen limpios (sin restos de formato de Notion) y las canceladas ya no aparecen.

## Novedades de la 1.23.1

- **Viendo**: Netflix ahora trae la carátula y el título original de cada serie y película, lee todo el historial (no solo lo último) y las fechas bien. Los capítulos que faltan se calculan con el título original en TVmaze (o AniList para el anime), por el número del capítulo o, si no lo tiene, por los capítulos distintos que viste de esa temporada. Arriba sale **Para ver ahora** (las recomendaciones se preparan solas después de leer un perfil), y abajo *Siguen viendo*, *Al día, esperando capítulo*, *Terminadas* y *Películas vistas*. Si leíste Netflix con la 1.23, vuelve a leer el perfil una vez.
- **Squads**: cada tarjeta lee de Notion los tickets de su responsable (abiertos, vencidos, los que vencen pronto y los cerrados del último mes) y muestra la lista de tickets abiertos (los vencidos primero, con su fecha) y las webs del squad que están en el pipeline con su estado.

## Novedades de la 1.23

- **Viendo (Netflix y Crunchyroll)**: inicias sesión tú en una ventana de la app, eliges el perfil y pulsas «Leer como Vincenzo» o «Leer como Emily». ViperTeca lee el historial de visionado de ese perfil (solo lectura) y muestra lo que siguen viendo, el último capítulo visto, cuántos capítulos faltan (de Netflix mismo, de AniList para el anime y de TVmaze), cuándo sale el siguiente si la serie sigue en emisión, lo que está al día o terminado y las películas recientes.
- **Qué ver después y estrenos**: tu Claude Code mira los dos historiales y busca en la web con qué seguir para cada uno, tres recomendaciones para ver juntos y los próximos estrenos de las próximas 8 semanas en Netflix y Crunchyroll.
- **En el iPhone**: Más → Viendo, con lo que falta de cada serie.

## Novedades de la 1.22

- **Websites → Alertas**: cada 6 horas (y cuando pulsas «Revisar todas ahora») ViperTeca abre cada web publicada en una ventana oculta, como un visitante, y avisa solo de lo que la rompe: la web no carga o da error, carga en blanco, errores de JavaScript (los que dejan botones y menús sin funcionar), scripts, estilos, imágenes o llamadas a la API que fallan, enlaces y botones internos que llevan a una página que no existe, errores en vivo de Vercel (funciones y respuestas 5xx) y deploys de producción fallidos. Nada de rendimiento. Cada aviso dice el squad y su responsable; se pueden ignorar avisos concretos y ver lo arreglado en la semana. No se revisa mientras juegas.
- **Websites → Squads**: una tarjeta por squad (A Vincenzo, B Camila Jouce, C Luis Chrestia, D Emily) con un semáforo, los tickets abiertos y vencidos de su responsable (campo Responsible de Notion), el porcentaje entregado a tiempo, los días medios por ticket, los cerrados por semana, sus webs publicadas y en curso, los deploys de la semana y fallidos y sus alertas abiertas; y una comparativa privada entre los cuatro.
- **Avisos en el iPhone**: con el enlace seguro de Tailscale (https, se activa una vez en el panel de Tailscale y con «Crear el enlace seguro» en «En el móvil»), la app del iPhone recibe los mismos avisos que el PC aunque estés fuera de casa, y abre sin conexión con lo último que viste. Avisos cifrados de punta a punta (Web Push estándar), sin servicios de terceros.

## Novedades de la 1.21.1

- **Mi día en la pantalla del case**: el panel de la pantalla vertical muestra tu día de arriba abajo (hora y clima, el juego y sus FPS si juegas, temperaturas, Spotify, la próxima reunión y el resto de la agenda, pagos, cosas de la casa, tickets, correo, Genshin, anime, juegos gratis y el clima por horas) y se abre solo al iniciar la app. Si algo no cabe, se quita lo de abajo.

## Novedades de la 1.21

- **Genshin → Lo que viene**: tu Claude Code busca en la web (anuncios oficiales, Game8, la wiki y filtraciones) y prepara el resumen de la historia de la versión actual (con y sin spoilers) y las tres próximas versiones con sus personajes, fechas y si cada dato es oficial, filtración o rumor, con las fuentes.
- **Genshin → Por quién tirar**: según tus personajes, tus tiradas y los banners de ahora y los que vienen, quién vale la pena, quién no y para quién ahorrar.
- **Genshin → Equipos**: equipos para el Abismo de Espiral y el Teatro Imaginario de la temporada actual armados solo con tus personajes, y qué te conviene subir.
- **Genshin → Eventos**: «Hecho» en cada evento y aviso cuando uno que no hiciste termina en menos de 48 horas.
- **Genshin → Inventario desde HoYoLAB**: «Leer de HoYoLAB» en Farmeo trae cuánto tienes de cada material del plan desde la calculadora oficial.
- **Puntuación de artefactos más justa**: en personajes de apoyo se valoran las tiradas útiles (recarga, maestría, % de vida o ataque) en vez del crítico.
- **Noche de juego** (Amigos): con los amigos elegidos, los 3 mejores juegos que tienen todos (multijugador, instalados, de la familia), la hora y una invitación lista para pegar en Discord o Steam.
- **Clips** en la ficha de cada juego: los vídeos de la Barra de juegos de Windows y de NVIDIA o AMD, con vista previa al pasar el ratón.
- **Reto del backlog**: una meta de juegos terminados al mes, con progreso y racha de meses cumplidos.
- **Precio histórico** de la lista de deseados: un minigráfico con el precio de cada día, el mínimo histórico de Steam (CheapShark) y aviso cuando un juego llega a su mínimo.
- **Diseño más pulido**: cifras en tarjetas en Logros, Estadísticas, Backlog y Websites, gráficos de barras nuevos, personajes de Genshin como cartas con su color de elemento y fotos de regalos enteras.

## Novedades de la 1.20

- **Mi día rediseñado**: un encabezado con el saludo, un resumen de una línea y el clima, y debajo bloques por tema (Ahora, Casa, Trabajo y Ocio) en tarjetas tipo widget, con anillos de progreso para el presupuesto y la resina y la agenda en línea de tiempo.
- **Pagos rediseñados**: cada pago muestra en grande el día del mes en que se paga, el estado (pagado, hoy, en X días, atrasado) y un resumen del mes con un anillo de pagados y una tira con los 31 días del mes.
- **Casa → Menú semanal**: almuerzo y cena de cada día y tus recetas con ingredientes; un botón pasa los que faltan a la lista de compras.
- **Casa → Hogar**: mantenimiento de la casa (filtro del agua, aire acondicionado, gas, fumigación, canoas…) con aviso, y garantías con foto de la factura y aviso un mes y una semana antes de que venzan.
- **Casa → Gastos compartidos**: quién pagó qué y entre quiénes, saldos de cada persona y los pagos sugeridos para quedar a mano.
- **Clima de Guápiles** en Mi día (ahora, próximas horas y el día), con aviso de lluvia fuerte o tormenta (Open-Meteo).
- **Widget de escritorio**: una ventanita con la hora, el clima, la próxima reunión, pagos, resina, el dólar y los tickets (botón en Mi día).
- **iPhone**: acciones rápidas en Más → PC (volumen, música, modo enfoque, bloquear, suspender y apagar con 1 minuto para cancelar) y los datos de la última vez cuando el PC no responde.
- **Datos más seguros**: si un archivo está ocupado o dañado, la app ya no empieza de cero: usa la copia anterior (cada guardado de tus datos importantes deja un .bak).
- Las sagas ya no muestran imágenes rotas (si el arte de un juego no existe, usan el del siguiente).

## Novedades de la 1.19

- **Genshin → Farmeo, tu plan de hoy**: en qué gastar la resina (el dominio de libros del día y para quién), jefes semanales con descuento que te quedan, encargos, expediciones listas, la tetera, el transformador, las especialidades listas para recoger y la recompensa diaria de HoYoLAB.
- **Inventario de materiales**: en cada material del plan anotas cuántos tienes (y tu mora) y te dice lo que falta; los completos se marcan.
- **Puntuación de artefactos**: cada pieza muestra su valor crítico (Prob. CRIT × 2 + Daño CRIT) con una nota (Joya, Muy bueno, Bueno, Normal o Para cambiar) y cada personaje el total, con las piezas que conviene cambiar.
- **Tu suerte en los deseos** (pestaña Deseos): un gráfico con lo que costó cada 5★, tu media frente a la de todos los jugadores, los 50/50 ganados y perdidos y tu racha.
- **Banners con probabilidad**: cada personaje del banner muestra la probabilidad de sacarlo antes de que termine, con lo que tienes y lo que juntes (según la Calculadora de tiradas).
- **Tienda de Paimon**: aparece en los reinicios y te avisa el día 1 de cada mes.
- **En el iPhone**: Genshin muestra encargos, jefes semanales, expediciones, la tetera y el transformador.

## Novedades de la 1.18

- **Diseño renovado en toda la app**: superficies con profundidad y una sola familia de tarjetas, títulos más firmes, Mi día con un saludo grande y cifras en tarjetas, menú lateral translúcido, botones que responden al pulsar, foco visible con el teclado, diálogos y avisos que entran suaves, y textos largos que ya no se salen.
- **Más personalización** (Ajustes → Apariencia → Estilo): densidad cómoda o compacta, esquinas rectas, suaves o redondas, luz de fondo apagada, suave o intensa, tamaño de la interfaz (90 a 120 %) y animaciones completas o mínimas.
- **ViperTeca en el iPhone**: en «En el móvil» hay una app completa para el celular (Hoy, Casa, Juegos, Genshin y Más: Pregúntale, trabajo, anime y el PC), en vivo mientras ViperTeca está abierta. Se instala desde Safari con «Añadir a pantalla de inicio». Desde el teléfono puedes marcar compras, pagos, recordatorios y recolecciones, anotar gastos, abrir juegos en el PC y preguntar.
- **Desde cualquier red con Tailscale**: si instalas Tailscale en el PC y en el iPhone (y entras tú con tu cuenta), aparece un segundo código que funciona con datos móviles o en otra wifi. Es una red privada entre tus aparatos: nada queda abierto a internet.
- **Genshin → Mapa**: el mapa interactivo oficial de HoYoLAB en una ventana de la app, con su propia sesión (tus marcas quedan guardadas) y abriéndose donde lo dejaste.

## Novedades de la 1.17

- **Rendimiento por juego**: en la ficha de cada juego, el FPS medio, el 1 % bajo y la temperatura máxima de CPU y GPU de cada partida medida con el modo enfoque, con un gráfico de las últimas 24.
- **No molestar mientras juegas** (Ajustes → Partidas): con el modo enfoque activo, los avisos esperan y al terminar llega uno solo («Mientras jugabas: N avisos»); quedan en Mi día. Las reuniones a punto de empezar y las temperaturas altas avisan siempre.
- **Genshin → Calculadora de tiradas**: con tus protogemas, destinos, brillos, lo que ganas al día (con o sin Bendición de la Luna) y la fecha (por defecto, la próxima versión), la probabilidad de conseguir el personaje o el arma (también constelaciones y refinamientos), con la tirada actual y el 50/50 leídos de tu historial de deseos.
- **Genshin → Especialidades y minerales** (en Farmeo): «Ya recogí» al pasar por la ruta y aviso cuando vuelven a salir (48 h las especialidades, 72 h los minerales); las especialidades de tu plan salen como accesos rápidos.
- **Casa → Trámites**: marchamo, revisión técnica (calcula el mes por el último dígito de la placa), licencia, cédula y pasaporte, con aviso un mes antes, una semana antes y el día. «Hecho» lo pasa al año siguiente.
- **Tipo de cambio**: el dólar del día del Banco Central en Mi día y en Presupuesto, con conversor; los pagos en dólares ya se suman al presupuesto en colones.
- **Pregúntale a ViperTeca**: un chat con tu Claude Code que conoce tu agenda, pagos, presupuesto, trámites, compras, cumpleaños, juegos, Genshin y anime, y busca en la web si hace falta. Solo lee: no cambia nada.
- **Mi día en el celular**: con el acceso desde el celular encendido, un QR en Mi día abre tu día en el teléfono (misma wifi), actualizado cada minuto.
- **Resumen del domingo**: los domingos desde las 18:00, un aviso con lo que viene la semana siguiente; los domingos y lunes, Mi día lo muestra arriba.
- **Cumpleaños renovado**: el próximo en grande, tu año mes a mes, personas con sus ideas de regalo y gatitos ordenados del mayor al menor (pon el año en que nació cada uno).
- **Workana en Brave**: «Postular en Brave» copia la propuesta y abre el proyecto en Brave, donde ya tienes la sesión; la ventana de la app queda como opción.

## Novedades de la 1.16

- **Mi día** es la pantalla de inicio: reuniones de hoy, pagos de la semana, cumpleaños, recordatorios, cuidados de los gatitos, tickets que vencen, correos sin leer, anime que sale, resina y reinicios de Genshin, presupuesto del mes y juegos gratis. Abajo, la copia en OneDrive.
- **Búsqueda global (Ctrl+K)**: además de juegos, encuentra secciones, regalos, compras, pagos, cumpleaños, recordatorios, tickets, webs, anime que sigues, correos y postulaciones.
- **Logros fáciles que te faltan** (botón en Logros): de los juegos que ya empezaste, los logros que tiene al menos 1 de cada 4 jugadores.
- **Gratis para quedártelos** (Novedades → Juegos): juegos regalados en Steam, GOG, Epic y Prime Gaming (GamerPower), con aviso cuando sale uno nuevo.
- **Mods** en la ficha de cada juego: los más recomendados de Nexus Mods, sin contenido para adultos.
- **Genshin → Farmeo**: cuándo se reinician el Abismo, el Teatro, los jefes semanales y los encargos; si ya reclamaste la recompensa diaria de HoYoLAB (con aviso si se te olvida); y los personajes de los banners con «Planear farmeo».
- **Casa → Presupuesto**: límite del mes y lo gastado (pagos pagados, compras con precio y gastos sueltos), con aviso al 90 % y al pasarte.
- **Casa → Gatitos**: vacunas, desparasitación, antipulgas y veterinario de cada gatito, con aviso 3 días antes y el día.
- **Lista de compras en el celular**: con «En el móvil» encendido, un QR abre la lista en el celular para verla, marcarla y añadir cosas.
- **Ideas de regalo**: 14 y 3 días antes de un cumpleaños te recuerda los regalos que tienes anotados para esa persona.
- **Alertas de alquiler**: con la ubicación elegida, Alquileres busca sola cada 4 horas y avisa de las publicaciones nuevas.
- **Panel del case**: suma los pagos y cumpleaños de la semana y la portada del próximo anime.
- **Copia en OneDrive**: una copia diaria de tus datos (sin claves ni tokens) en OneDrive\ViperTeca\Copias, se guardan las 10 últimas.
- **Sinopsis de anime en español**: «Traducir sinopsis al español» las traduce con tu Claude Code (Haiku) una vez y quedan guardadas.
- **Websites → Salud**: botón «Ocultar» en cada web (Fun Tapas viene oculta).

## Biblioteca familiar de Steam

La biblioteca incluye también los juegos que te comparte tu **grupo familiar de Steam**, así salen completas las sagas. En **Sagas**, pulsa «Conectar con Steam»: se abre Steam en una ventana de la app, inicias sesión tú y, desde ahí, cada vez que actualizas la biblioteca se suman los juegos de la familia (solo lectura). En cada juego compartido verás de quién es.

## Casa

Sección **Casa** del menú, todo guardado en este PC y editable (crear, editar y eliminar):

- **Compras**: la lista de la casa por categorías (súper, verdulería, limpieza, gatos…). Marcas lo que compras, quitas lo comprado y puedes copiar la lista para mandarla por WhatsApp.
- **Pagos**: alquiler, agua, luz, internet y demás, divididos en grupos (Personal, Abuela, Abuelo y los que crees). Pones el día del mes y ves cuántos días faltan; marcas cada mes como pagado. Te avisa unos días antes, el mismo día y si se atrasa. Los que aún no tienen fecha quedan como «Fecha por confirmar».
- **Recordatorios**: visitas, citas y fechas sueltas, con aviso antes y el mismo día.
- **Cumpleaños**: personas y gatitos, con cuenta regresiva y edad si pones el año. Si solo sabes el mes, se guarda así hasta que pongas el día.
- **Regalos**: ideas de regalos por persona (empieza con los de Emi), con foto (elegida, pegada con Ctrl+V o por enlace), detalles, ocasión, precio, dónde comprarlo y estado: idea, comprado o entregado.
- **Alquileres**: publicaciones de alquiler de propiedades de Facebook Marketplace entre tu precio mínimo y máximo (por defecto ₡130.000 a ₡250.000) en Guápiles, en tarjetas con foto, precio y lugar; marca las nuevas, puedes guardar las que te gustan y abrirlas en el navegador. Marketplace necesita tu sesión: la primera vez se abre Facebook en una ventana de la app, entras tú y eliges Guápiles en el filtro de ubicación (la app lo recuerda). Solo lee cuando pulsas «Buscar».
- **Feriados**: feriados nacionales oficiales de Estados Unidos, Argentina y Costa Rica (Nager.Date; no se editan), en lista o en calendario mes a mes, y si quieres con tus cumpleaños, recordatorios y pagos encima.

## Novedades de la 1.9

**Websites por squad, salud y Vercel.** Las webs se agrupan por squad (A, B, C, D), según el nombre de la carpeta o el squad del pipeline de Notion. La pestaña *Salud de las webs* vigila cada 30 minutos las webs publicadas (del pipeline de Notion, de Vercel o las que añadas): si responden, cuánto tardan y cuándo vence su SSL. Te avisa si una se cae, cuando vuelve y si al SSL le quedan menos de 14 días. Con una clave gratuita de PageSpeed Insights (la pegas tú) mide velocidad, SEO y accesibilidad. *Despliegues de Vercel*, con tu token de Vercel, muestra el último despliegue de producción y de preview de cada proyecto (rama, commit, autor) y te avisa cuando uno falla.

**Avisos de Notion.** Cada 10 minutos revisa tus tickets: te avisa de un ticket nuevo a tu nombre, cuando alguien te menciona y cuando hay mensajes nuevos en el chat de tus tickets abiertos.

**Sensores** (Tu PC → Sensores). Uso de CPU, GPU y RAM en tiempo real. Con [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases) abierto y su *Remote Web Server* activado, también temperaturas y ventiladores, con aviso si la CPU o la GPU pasan tu límite. La temperatura máxima de cada partida con modo enfoque queda en el registro de partidas.

**Pantalla del case.** Desde Sensores, ViperTeca pone en la pantalla vertical del case un panel con la hora, tu próxima reunión y las del día, lo que suena en Spotify, temperaturas, FPS mientras juegas, la resina de Genshin y los tickets vencidos. Puede abrirse sola al iniciar la app.

**Backlog** (Tu biblioteca → Backlog). Para los juegos que marcaste como *Jugando* o *Pendiente*, busca su duración en HowLongToBeat, te dice cuánto te falta de cada uno y cuándo lo terminarías con tu ritmo de las últimas cuatro semanas. *¿A qué juego?* elige más a menudo los que te faltan menos de 6 horas.

**Genshin: Farmeo y Códigos.** *Farmeo*: eliges personajes, su nivel y talentos actuales y a dónde quieres llegar, y calcula los materiales (libros, jefes, gemas, especialidades y mora) y qué dominio de talentos toca hoy. También lleva la resina (de HoYoLAB o escrita por ti) y avisa cuando se llena o cuando vuelven las expediciones. *Códigos*: los códigos de canje vigentes, con aviso cuando sale uno nuevo; *Canjear* abre la página oficial con el código puesto.

**Workana: Mis postulaciones.** Lo que postulaste, con tu precio y el presupuesto del cliente. Marcas si la vieron, te respondieron, la ganaste o no salió, y te dice a qué precio (respecto al presupuesto) ganas más.

## Trucos

**Tu biblioteca → Trucos** es un motor de trucos propio, como los de Wand o Cheat Engine, para juegos **de un jugador**:

1. Abre el juego y elígelo en la lista. Si el juego es en línea o tiene antitrampas (Genshin, Fortnite, Valorant, EasyAntiCheat, BattlEye…), ViperTeca **no se engancha**, para que no pierdas tu cuenta.
2. Busca el valor que quieres cambiar (oro, vida, munición): escribe cuánto tienes, cambia esa cantidad en el juego y filtra (*ahora vale…*, *ha subido*, *ha bajado*…) hasta que queden pocos resultados.
3. Añádelo a **Mis trucos**: ponle nombre, cámbialo al número que quieras o **congélalo**, y asígnale un **atajo** (F5…F11, Ctrl+número, Alt+número) que funciona dentro del juego.

Los trucos se guardan por juego. También puedes **importar tablas de Cheat Engine (.CT)** de la comunidad: se cargan las entradas con dirección y punteros; las que son scripts de Cheat Engine no son compatibles. Si un juego se ejecuta como administrador, abre ViperTeca también como administrador.

## Iluminación RGB

**Tu PC → Iluminación** controla el RGB del PC (ventiladores, placa base, teclado…) con [OpenRGB](https://openrgb.org/), de código abierto, por debajo: un color y un efecto (fijo, respirar, arcoíris, ola, apagado) para todo a la vez, o modo, color, velocidad, brillo y número de LED de cada dispositivo.

Para el RGB que va a la **placa base** (como unos ventiladores conectados a su conector ARGB de 5 V) OpenRGB necesita su controlador [PawnIO](https://pawnio.eu/): instálalo tú y pulsa *Abrir como administrador* en ViperTeca (Windows te pedirá permiso). En los conectores ARGB indica cuántos LED hay en total.

## Tu saldo en Steam y Epic

En **Ofertas → Tu saldo**, *Conectar* abre la web oficial de Steam o de Epic para que inicies sesión tú, y la app lee tu cartera de Steam y tus **Epic Rewards** y saldo de Epic. Ninguna de las dos tiendas lo da a otros programas, así que se lee de su web; la sesión se guarda como en un navegador y *Desconectar* la borra.

## Instalador

```bash
npm run dist
```

Descarga PresentMon (y comprueba su huella) y genera `dist/ViperTeca-Setup-<versión>.exe`. El instalador es solo para tu usuario (no pide administrador), crea el acceso directo en el escritorio y en el menú Inicio, y aparece en *Configuración → Aplicaciones* para desinstalarlo. Tus datos están en `%APPDATA%\biblioteca-juegos` y no se borran al desinstalar ni al actualizar.

**Actualizaciones automáticas:** necesitan un sitio en internet donde publicar cada versión (por ejemplo, un repositorio de GitHub con *Releases*). Mientras no exista, para actualizar basta con generar el instalador nuevo y ejecutarlo encima: conserva tus datos.

## Comprobación sin ventana

```bash
npm run check
```

Lee las fuentes locales y muestra un resumen en la consola, sin abrir la ventana.
