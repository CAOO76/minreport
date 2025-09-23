# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - navigation [ref=e5]:
        - link "Home" [ref=e6] [cursor=pointer]:
          - /url: http://localhost:5179/
        - link "Solicitar Acceso" [ref=e7] [cursor=pointer]:
          - /url: /request-access
      - generic [ref=e8]:
        - link "login" [ref=e9] [cursor=pointer]:
          - /url: /login
          - generic [ref=e10] [cursor=pointer]: login
        - button "Cambiar tema" [ref=e11] [cursor=pointer]:
          - generic [ref=e12] [cursor=pointer]: dark_mode
    - main [ref=e13]:
      - generic [ref=e14]:
        - heading "Iniciar Sesión" [level=2] [ref=e15]
        - paragraph [ref=e16]: Bienvenido de nuevo. Ingresa tus credenciales para acceder a tu cuenta.
        - generic [ref=e17]:
          - paragraph [ref=e18]: Credenciales inválidas o acceso no autorizado.
          - generic [ref=e19]:
            - generic [ref=e20]: Correo Electrónico
            - textbox "Correo Electrónico" [ref=e21]: test@example.com
          - generic [ref=e22]:
            - generic [ref=e23]: Contraseña
            - generic [ref=e24]:
              - textbox "Contraseña" [ref=e25]: password123
              - button "Mostrar contraseña" [ref=e26] [cursor=pointer]:
                - generic [ref=e27] [cursor=pointer]: visibility
          - link "¿Olvidaste tu contraseña?" [ref=e29] [cursor=pointer]:
            - /url: "#"
          - button "Iniciar Sesión" [ref=e30] [cursor=pointer]
  - paragraph [ref=e31]: Running in emulator mode. Do not use with production credentials.
```