# Scraper

## How to update Docker Hub with the project and dependencies

```sh
docker build -t remysharp/scrapper:main .
docker login -u remysharp
docker push remysharp/scrapper:latest
```

Once complete, in the container in Portainer in Home Assistant, find the container and then "Recreate" selecting the "Re-pull image" option.