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
