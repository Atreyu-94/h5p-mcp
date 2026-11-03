<?php
// Test-only host adapter for the unmodified official H5P PHP package validator.
// Usage: php -d extension=mbstring -d extension=zip h5p-php-probe.php <core-dir> <corpus-report> <output-dir>
[$script, $coreRoot, $corpusFile, $output] = $argv;
if (hash_file('sha256', "$coreRoot/h5p.classes.php") !== '6924b5f9559192998db06a1bbafeefd1a86976e8cd0c23a966fa297ec01c63e9') {
  throw new RuntimeException('Unexpected H5P Core source');
}
foreach (['h5p-file-storage.interface.php','h5p-default-storage.class.php','h5p-development.class.php','h5p.classes.php','h5p-metadata.class.php'] as $file) require_once "$coreRoot/$file";
class ProbeHost {
  public $package, $directory, $errors = [], $allowSvgContent = false;
  public function dispatch($method, $args) {
    switch ($method) {
      case 'getUploadedH5pPath': return $this->package;
      case 'getUploadedH5pFolderPath': return $this->directory;
      case 'getOption': return $args[1] ?? null;
      case 'mayUpdateLibraries': return true;
      case 'getLibraryId': case 'libraryHasUpgrade': return false;
      case 'getWhitelist': return $args[1] . ($args[0] ? ' '.$args[2] : ($this->allowSvgContent ? ' svg' : ''));
      case 't': return strtr($args[0], $args[1] ?? []);
      case 'setErrorMessage': $this->errors[] = ['message'=>$args[0], 'code'=>$args[1] ?? null]; return;
      case 'setInfoMessage': return;
      default: throw new LogicException("Unimplemented host operation: $method");
    }
  }
}
// Generate only interface plumbing; all validation remains in upstream classes.
// Unexpected host calls fail instead of being silently accepted.
$methods = '';
foreach ((new ReflectionClass('H5PFrameworkInterface'))->getMethods() as $method) {
  $params = [];
  foreach ($method->getParameters() as $param) {
    $params[] = ($param->hasType() ? $param->getType().' ' : '') . ($param->isPassedByReference() ? '&' : '') . '$'.$param->getName() .
      ($param->isDefaultValueAvailable() ? '='.var_export($param->getDefaultValue(), true) : '');
  }
  $methods .= 'public function '.$method->getName().'('.implode(',', $params).'){return $this->dispatch(__FUNCTION__,func_get_args());}';
}
eval('class Framework extends ProbeHost implements H5PFrameworkInterface {'.$methods.'}');
if (!is_dir($output)) mkdir($output, 0777, true);
$corpus = json_decode(file_get_contents($corpusFile), true, 512, JSON_THROW_ON_ERROR);
$negativeFile = $output.'/negative-missing-dependency.h5p';
if (file_exists($negativeFile)) throw new RuntimeException('Negative control already exists');
copy($corpus['packages'][0]['file'], $negativeFile);
$negativeZip = new ZipArchive();
if ($negativeZip->open($negativeFile) !== true) throw new RuntimeException('Cannot open negative control');
$metadata = json_decode($negativeZip->getFromName('h5p.json'), true, 512, JSON_THROW_ON_ERROR);
$metadata['preloadedDependencies'][] = ['machineName'=>'H5P.DoesNotExist','majorVersion'=>1,'minorVersion'=>0];
$negativeZip->addFromString('h5p.json', json_encode($metadata));
$negativeZip->close();
$corpus['packages'][] = ['file'=>$negativeFile, 'expected_valid'=>false, 'allow_svg_content'=>$corpus['packages'][0]['allow_svg_content'] ?? false];
$results = [];
foreach ($corpus['packages'] as $i => $item) {
  $host = new Framework();
  $host->allowSvgContent = $item['allow_svg_content'] ?? false;
  $host->directory = $output.'/case-'.$i;
  if (file_exists($host->directory)) throw new RuntimeException('Output already exists');
  mkdir($host->directory);
  $host->package = $host->directory.'/upload.h5p';
  copy($item['file'], $host->package); // Upstream consumes this copy, never the original.
  $core = new H5PCore($host, $host->directory, '');
  $validator = new H5PValidator($host, $core);
  $ok = $validator->isValidPackage(false, false);
  $results[] = ['file'=>basename($item['file']), 'sha256'=>hash_file('sha256',$item['file']),'allow_svg_content'=>$host->allowSvgContent, 'ok'=>$ok,'expected_valid'=>$item['expected_valid'] ?? true,'errors'=>$host->errors];
}
$report = ['validator'=>'h5p/h5p-php-library','commit'=>'1e21b7a2da4ae9c4f1f9e61f7ae1038f8850fb82','core'=>H5PCore::$coreApi,'php'=>PHP_VERSION,'packages'=>$results,'playback'=>'not_run','grading'=>'not_run'];
file_put_contents($output.'/report.json', json_encode($report, JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES));
echo json_encode($report, JSON_UNESCAPED_SLASHES).PHP_EOL;
exit(count(array_filter($results, fn($item)=>$item['ok'] !== $item['expected_valid'])) ? 1 : 0);
